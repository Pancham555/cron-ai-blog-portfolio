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

  const newsSources = ['bbc-news', 'cnn', 'the-verge', 'techcrunch', 'business-insider'];

  let articles = [];
  try {
    const url = `https://newsapi.org/v2/top-headlines?sources=${newsSources.join(',')}&pageSize=5&apiKey=${newsApiKey}`;
    const response = await axios.get(url);
    articles = response.data.articles;
  } catch (err) {
    console.error('❌ News API error:', err.message);
    return res.status(500).send(`Error fetching news: ${err.message}`);
  }

  if (!articles || articles.length === 0) {
    return res.status(500).send('No news articles found.');
  }

  const combinedArticlesText = articles
    .map((a, i) => `Article ${i + 1} from ${a.source.name}:
Title: ${a.title}
Description: ${a.description || ''}
Content: ${a.content || ''}
URL: ${a.url}`)
    .join('\n\n')
    .slice(0, 8000);

  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a news summarization assistant.' },
        { role: 'user', content: `Summarize and unify these news articles on ${baseTopic} into an ~800-word blog post:\n\n${combinedArticlesText}` }
      ],
      max_tokens: 1200,
      temperature: 0.7
    });
    aiText = completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('❌ Groq AI error:', err.message);
    return res.status(500).send(`AI generation failed: ${err.message}`);
  }

  let dynamicTitle = baseTopic;
  try {
    const client = new Groq({ apiKey: groqKey });
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are an expert headline writer.' },
        { role: 'user', content: `Create a short title (6 words max) for this article.` }
      ],
      max_tokens: 20,
      temperature: 0.5
    });
    dynamicTitle = completion.choices[0].message.content.trim().replace(/["'*]/g, '');
  } catch (err) {
    console.error('❌ Title generation error:', err.message);
  }

  let dynamicDescription = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional copywriter.' },
        { role: 'user', content: `Write a 12-word max summary for a blog post about ${baseTopic}.` }
      ],
      max_tokens: 30,
      temperature: 0.7
    });
    dynamicDescription = completion.choices[0].message.content.trim().replace(/Here is.*?:\s*/i, '').replace(/["'*]/g, '');
  } catch (err) {
    console.error('❌ Description generation error:', err.message);
    dynamicDescription = aiText.split('\n\n')[0].split(' ').slice(0, 12).join(' ');
  }

  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const slug = dynamicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const icon = String(Math.floor(Math.random() * 5) + 1);
  let heroImage = '';

  try {
    const assetsDir = path.resolve(process.cwd(), 'src/assets');
    const files = fs.readdirSync(assetsDir).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
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
---\n\n${aiText}\n`;

  try {
    const octo = new Octokit({ auth: ghToken });
    const refData = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseSha = refData.data.object.sha;
    const commitData = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const parentTree = commitData.data.tree.sha;

    const treeData = await octo.rest.git.createTree({
      owner,
      repo,
      base_tree: parentTree,
      tree: [
        {
          path: filePath,
          mode: '100644',
          type: 'blob',
          content: markdown
        }
      ]
    });

    const newCommit = await octo.rest.git.createCommit({
      owner,
      repo,
      message: `chore: add unified news article for ${dateObj.toISOString().slice(0, 10)}`,
      tree: treeData.data.sha,
      parents: [baseSha]
    });

    await octo.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha
    });

  } catch (err) {
    console.error('❌ GitHub commit error:', err.message);
    return res.status(500).send(`GitHub commit failed: ${err.message}`);
  }

  return res.status(200).send('Unified article generated ✅');
}
