import Groq from 'groq-sdk';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export default async function handler(req, res) {
  const baseTopic = 'Business and Artificial Intelligence News and Current Updates';
  const newsApiKey = process.env.NEWS_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner = 'pancham555';
  const repo = 'cron-ai-blog-portfolio';
  const branch = 'master';

  if (!newsApiKey || !groqKey || !ghToken) {
    return res.status(500).send('Error: Required API keys are not set');
  }

  // 1. Attempt to fetch top headlines
  const sources = ['bbc-news', 'cnn', 'the-verge', 'techcrunch', 'business-insider'];
  let articles = [];
  try {
    const headlinesUrl = `https://newsapi.org/v2/top-headlines?sources=${sources.join(
      ',')}&pageSize=5&apiKey=${newsApiKey}`;
    const { data } = await axios.get(headlinesUrl);
    if (data.status === 'ok' && Array.isArray(data.articles)) {
      articles = data.articles;
    } else {
      console.warn('NewsAPI top-headlines returned no articles, falling back.', data);
    }
  } catch (err) {
    console.warn('Error fetching top-headlines:', err.message);
  }

  // 2. Fallback to 'everything' query if no headlines
  if (!articles.length) {
    try {
      const query = encodeURIComponent('business artificial intelligence');
      const everythingUrl = `https://newsapi.org/v2/everything?q=${query}&language=en&pageSize=5&sortBy=publishedAt&apiKey=${newsApiKey}`;
      const { data } = await axios.get(everythingUrl);
      if (data.status === 'ok' && Array.isArray(data.articles)) {
        articles = data.articles;
      } else {
        console.error('NewsAPI everything returned no articles.', data);
      }
    } catch (err) {
      console.error('Error fetching everything:', err.message);
    }
  }

  if (!articles.length) {
    return res.status(500).send('Error: No news articles found from NewsAPI');
  }

  // Combine and truncate for AI prompt
  const combined = articles
    .map((a, i) => `Article ${i + 1} from ${a.source.name}:\nTitle: ${a.title}\nDescription: ${a.description || ''}\nContent: ${a.content || ''}\nURL: ${a.url}`)
    .join('\n\n')
    .slice(0, 8000);

  // 3. Generate unified article
  let aiText;
  try {
    const client = new Groq({ apiKey: groqKey });
    const prompt = `Read these articles on ${baseTopic} and write an ~800-word unified article using the standard markdown syntax and add numeric or other details if you could find any for this : (\n\n${combined}).`;
    const response = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a news summarization assistant.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1200,
      temperature: 0.7
    });
    aiText = response.choices[0].message.content.trim();
  } catch (err) {
    console.error('Groq AI summarization error:', err.message);
    return res.status(500).send(`AI error: ${err.message}`);
  }

  // 4. Title & description
  // let title = baseTopic;
  let title;
  try {
    const client = new Groq({ apiKey: groqKey });
    const tRes = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are an expert headline writer.' },
        { role: 'user', content: `Create a concise, 6-word max title for this article text (${aiText}) without using filler words like here is; just return me the title.` },
        { role: 'user', content: aiText }
      ],
      max_tokens: 20,
      temperature: 0.5
    });
    title = tRes.choices[0].message.content.trim().replace(/["'*]/g, '');
  } catch (e) {
    console.warn('Title generation failed:', e.message);
  }

  let description;
  try {
    const client = new Groq({ apiKey: groqKey });
    const dRes = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional copywriter.' },
        { role: 'user', content: `Write a pure, 12-word max summary for this article (${aiText}) without any filler words like here is... Just return me the description.` },
        { role: 'user', content: aiText }
      ],
      max_tokens: 30,
      temperature: 0.7
    });
    description = dRes.choices[0].message.content.trim().replace(/Here is.*?:\s*/i, '').replace(/["'*]/g, '');
  } catch (e) {
    console.warn('Description generation failed:', e.message);
    description = aiText.split('\n\n')[0].split(' ').slice(0,12).join(' ');
  }

  // 5. Prepare markdown
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const icon = `${Math.floor(Math.random() * 5) + 1}`;
  let heroImage = '';
  try {
    const dir = path.resolve(process.cwd(), 'src/assets');
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
    heroImage = files.length ? `/src/assets/${files[0]}` : '';
  } catch {}

  const filePath = `src/content/blog/${dateObj.toISOString().slice(0,10)}-${slug}.md`;
  const markdown = `---
title: '${title}'
description: '${description}'
icon: '${icon}'
pubDate: '${pubDate}'
heroImage: '${heroImage}'
---

${aiText}
`;

  // 6. Commit to GitHub
  try {
    const octo = new Octokit({ auth: ghToken });
    const { data: refData } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseSha = refData.object.sha;
    const { data: commitData } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const parentTree = commitData.tree.sha;
    const { data: treeData } = await octo.rest.git.createTree({ owner, repo, base_tree: parentTree, tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }] });
    const { data: newCommit } = await octo.rest.git.createCommit({ owner, repo, message: `chore: add unified news article for ${dateObj.toISOString().slice(0,10)}`, tree: treeData.sha, parents: [baseSha] });
    await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
  } catch (err) {
    console.error('GitHub commit failed:', err.message);
    return res.status(500).send(`GitHub error: ${err.message}`);
  }

  res.status(200).send('Unified article generated ✅');
}
