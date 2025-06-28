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

  // 1. Fetch top headlines or fallback to 'everything'
  const sources = ['bbc-news', 'cnn', 'the-verge', 'techcrunch', 'business-insider'];
  let articles = [];

  try {
    const url = `https://newsapi.org/v2/top-headlines?sources=${sources.join(',')}&pageSize=5&apiKey=${newsApiKey}`;
    const { data } = await axios.get(url);
    if (data.status === 'ok' && Array.isArray(data.articles) && data.articles.length) {
      articles = data.articles;
    }
  } catch {}

  if (!articles.length) {
    const query = encodeURIComponent('business artificial intelligence');
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&pageSize=5&sortBy=publishedAt&apiKey=${newsApiKey}`;
    try {
      const { data } = await axios.get(url);
      if (data.status === 'ok' && Array.isArray(data.articles)) {
        articles = data.articles;
      }
    } catch {}
  }

  if (!articles.length) {
    return res.status(500).send('Error: No news articles found from NewsAPI');
  }

  // 2. Prepare combined text for AI (with URLs)
  const combined = articles
    .map((a, i) =>
      `Article ${i + 1} (${a.source.name}): ${a.title} - ${a.url}`
    )
    .join('\n');

  // 3. Generate unified markdown article with links
  let aiText;
  try {
    const client = new Groq({ apiKey: groqKey });
    const prompt = `Read these articles on ${baseTopic} and write an ~800-word markdown-formatted article that weaves together the key points. Include links using [title](url) syntax. Avoid any filler intro like 'Here is'.\n\n${combined}`;
    const { choices } = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a news summarization assistant.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1200,
      temperature: 0.7
    });
    aiText = choices[0].message.content.trim();
  } catch (err) {
    return res.status(500).send(`AI error: ${err.message}`);
  }

  // 4. Generate title without filler words
  let title = baseTopic;
  try {
    const client = new Groq({ apiKey: groqKey });
    const { choices } = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are an expert headline writer.' },
        { role: 'user', content: 'Craft a concise 6-word maximum title for this article. No filler like "Here is".' },
        { role: 'user', content: aiText }
      ],
      max_tokens: 20,
      temperature: 0.5
    });
    title = choices[0].message.content.trim().replace(/['"*]/g, '');
  } catch {}

  // 5. Generate description without filler
  let description = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const { choices } = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional copywriter.' },
        { role: 'user', content: 'Write a 12-word maximum summary for this article. No filler like "Here is".' },
        { role: 'user', content: aiText }
      ],
      max_tokens: 30,
      temperature: 0.7
    });
    description = choices[0].message.content.trim().replace(/['"*]/g, '');
  } catch {
    description = aiText.split('\n')[0].split(' ').slice(0, 12).join(' ');
  }

  // 6. Prepare markdown file
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const icon = `${Math.floor(Math.random() * 5) + 1}`;
  let heroImage = '';
  try {
    const assets = fs.readdirSync(path.resolve(process.cwd(), 'src/assets'));
    const file = assets.find(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
    heroImage = file ? `/src/assets/${file}` : '';
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

  // 7. Commit to GitHub
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
    return res.status(500).send(`GitHub error: ${err.message}`);
  }

  res.status(200).send('Unified article generated ✅');
}
