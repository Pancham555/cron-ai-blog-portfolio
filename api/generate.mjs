import Groq from 'groq-sdk';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export default async function handler(req, res) {
  const baseTopic = 'Business and Artificial Intelligence News and Current Updates';

  // News API setup
  const newsApiKey = process.env.NEWS_API_KEY;
  const newsSources = [
    'bbc-news',
    'cnn',
    'the-verge',
    'techcrunch',
    'business-insider'
  ];

  if (!newsApiKey) {
    return res.status(500).send('Error: NEWS_API_KEY must be set');
  }

  // Fetch top headlines from multiple sources
  let articles = [];
  try {
    const url = `https://newsapi.org/v2/top-headlines?sources=${newsSources.join(',')}&pageSize=5&apiKey=${newsApiKey}`;
    const response = await axios.get(url);
    articles = response.data.articles;
  } catch (err) {
    console.error('❌ News API request error:', err.message);
    return res.status(500).send(`Error fetching news: ${err.message}`);
  }

  if (!articles || articles.length === 0) {
    return res.status(500).send('Error: No articles fetched from News API');
  }

  // Build a unified raw text of all articles, truncated to avoid exceeding token limits
  const combinedArticlesText = articles
    .map((a, i) => `Article ${i + 1} from ${a.source.name}:
Title: ${a.title}
Description: ${a.description || ''}
Content: ${a.content || ''}
URL: ${a.url}`)
    .join('\n\n');

  // Truncate input to ~8000 characters for safety
  const safeInput = combinedArticlesText.slice(0, 8000);

  // AI and GitHub setup
  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner = 'pancham555';
  const repo = 'cron-ai-blog-portfolio';
  const branch = 'master';

  if (!groqKey || !ghToken) {
    return res.status(500).send('Error: GROQ_API_KEY and GITHUB_TOKEN must be set');
  }

  // Generate unified article via AI
  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const prompt = `Read these news articles on ${baseTopic} and write an ~800-word unified article that weaves together the key points. Be concise and avoid filler.\n\n${safeInput}`;
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a news summarization assistant.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1200,
      temperature: 0.7,
    });
    aiText = completion.choices[0].message.content.trim();
    if (!aiText) throw new Error('Received empty response from Groq AI');
  } catch (err) {
    console.error('❌ Groq AI error:', err.response?.data || err.message);
    return res.status(500).send(`Error generating content: ${err.message}`);
  }

  // Generate dynamic title
  let dynamicTitle = baseTopic;
  try {
    const client = new Groq({ apiKey: groqKey });
    const titlePrompt = `Provide a concise, 6-word max title reflecting this unified article.`;
    const titleCompletion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are an expert headline writer.' },
        { role: 'user', content: titlePrompt }
      ],
      max_tokens: 20,
      temperature: 0.5,
    });
    const rawTitle = titleCompletion.choices[0].message.content.trim();
    if (rawTitle) dynamicTitle = rawTitle.replace(/["'*]/g, '');
  } catch (err) {
    console.error('❌ Title AI error:', err.message);
  }

  // Generate dynamic description
  let dynamicDescription = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const descPrompt = `Write a pure, 12-word max summary for this article. No intros.`;
    const descCompletion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional copywriter.' },
        { role: 'user', content: descPrompt }
      ],
      max_tokens: 30,
      temperature: 0.7,
    });
    const rawDesc = descCompletion.choices[0].message.content.trim();
    dynamicDescription = rawDesc.replace(/Here is.*?:\s*/i, '') || aiText.split('\n\n')[0].split(' ').slice(0, 12).join(' ');
  } catch (err) {
    console.error('❌ Description AI error:', err.message);
    dynamicDescription = aiText.split('\n\n')[0].split(' ').slice(0, 12).join(' ');
  }

  // Prepare markdown frontmatter
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const slug = dynamicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const icon = String(Math.floor(Math.random() * 5) + 1);
  let heroImage = '';
  try {
    const assetsDir = path.resolve(process.cwd(), 'src/assets');
    const files = fs.readdirSync(assetsDir).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f));
    heroImage = files.length ? `/src/assets/${files[0]}` : '';
  } catch {
    heroImage = '';
  }

  const filePath = `src/content/blog/${dateObj.toISOString().slice(0, 10)}-${slug}.md`;
  const markdown = `---
title: '${dynamicTitle}'
description: '${dynamicDescription}'
icon: '${icon}'
pubDate: '${pubDate}'
heroImage: '${heroImage}'
---

${aiText}
`;

  // Commit to GitHub
  try {
    const octo = new Octokit({ auth: ghToken });
    const {
      data: { object: { sha: baseSha } },
    } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const {
      data: { tree: parentTree },
    } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const {
      data: { sha: newTreeSha },
    } = await octo.rest.git.createTree({
      owner,
      repo,
      base_tree: parentTree,
      tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }],
    });
    const {
      data: { sha: newCommitSha },
    } = await octo.rest.git.createCommit({
      owner,
      repo,
      message: `chore: add unified news article for ${dateObj.toISOString().slice(0, 10)}`,
      tree: newTreeSha,
      parents: [baseSha],
    });
    await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommitSha });
  } catch (err) {
    console.error('❌ GitHub error:', err.message || err);
    return res.status(500).send(`Error committing to GitHub: ${err.message}`);
  }

  return res.status(200).send('Unified article generated ✅');
}
