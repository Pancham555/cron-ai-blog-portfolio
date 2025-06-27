// api/generate.mjs

import fetch from 'node-fetch';
import Groq from 'groq-sdk';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // 0️⃣ CONFIGURE your base topic and data source:
  const baseTopic = 'Business and Artificial Intelligence';
  const newsDataEndpoint = 'https://newsdata.io/api/1/news';

  // 1️⃣ Load env vars
  const newsDataKey = process.env.NEWSDATA_API_KEY;
  const groqKey     = process.env.GROQ_API_KEY;
  const ghToken     = process.env.GITHUB_TOKEN;
  const owner       = 'pancham555';
  const repo        = 'cron-ai-blog-portfolio';
  const branch      = 'master';

  if (!newsDataKey || !groqKey || !ghToken) {
    return res.status(500).send(
      'Error: NEWSDATA_API_KEY, GROQ_API_KEY and GITHUB_TOKEN must be set'
    );
  }

  // ─── 2. Fetch latest news articles from NewsData.io ───────────
  let fetchedArticles = [];
  try {
    // NewsData.io pages start at 1, not 0
    const url = `${newsDataEndpoint}?apikey=${newsDataKey}&q=${encodeURIComponent(baseTopic)}&language=en&page=1`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (data.status === 'error' || !data.results) {
      throw new Error(data.message || 'API returned an error');
    }
    if (!Array.isArray(data.results) || data.results.length === 0) {
      throw new Error('No articles returned');
    }

    // Use only first 5 articles (or fewer if less returned)
    fetchedArticles = data.results.slice(0, 5).map(a => ({
      title: a.title || 'No Title',
      description: a.description || a.content || 'No description available.'
    }));
  } catch (err) {
    console.error('❌ NewsData.io error:', err);
    return res.status(500).send(`Error fetching news: ${err.message}`);
  }

  // ─── 3. Generate combined article via Groq AI ────────────────
  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const articlesText = fetchedArticles
      .map((a, i) => `(${i + 1}) ${a.title}\n${a.description}`)
      .join('\n\n');

    const prompt =
      `Here are the ${fetchedArticles.length} latest news articles on ${baseTopic} (title + description):\n\n` +
      `${articlesText}\n\n` +
      'Using the above, write an ~800-word blog post following this format:\n' +
      '- Title: concise & engaging (under 10 words)\n' +
      '- Subtitle: single-sentence summary\n' +
      '- Body: introduction, key news analyses, insights, and conclusion';

    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional journalist and blog writer.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1200,
      temperature: 0.7,
    });
    aiText = completion.choices[0].message.content.trim();
    if (!aiText) throw new Error('Received empty response from Groq AI');
  } catch (err) {
    console.error('❌ Groq AI error:', err.response?.data || err.message || err);
    return res.status(500).send(`Error generating content: ${err.message}`);
  }

  // ─── 4. Split out title & description from AI output ──────────
  const [titleLine, subtitleLine, ...bodyLines] = aiText.split('\n');
  const dynamicTitle = titleLine.replace(/^Title:\s*/i, '') || baseTopic;
  const dynamicDescription = subtitleLine.replace(/^Subtitle:\s*/i, '') || '';
  const bodyContent = bodyLines.join('\n').trim();

  // ─── 5. Prepare frontmatter & markdown ────────────────────────
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  let slug = dynamicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (slug.length > 50) slug = slug.slice(0, 50);
  const icon = String(Math.floor(Math.random() * 5) + 1);
  let heroImage = '';
  try {
    const files = fs.readdirSync(path.resolve(process.cwd(), 'src/assets'))
      .filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
    heroImage = files.length ? `/src/assets/${files[0]}` : '';
  } catch {
    heroImage = '';
  }

  const filePath = `src/content/blog/${dateObj.toISOString().slice(0, 10)}-${slug}.md`;
  const markdown = `---
metadata:
  title: '${dynamicTitle}'
  description: '${dynamicDescription}'
  icon: '${icon}'
  pubDate: '${pubDate}'
  heroImage: '${heroImage}'
---

${bodyContent}
`;

  // ─── 6. Commit to GitHub ─────────────────────────────────────
  try {
    const octo = new Octokit({ auth: ghToken });
    const { data: refData } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseSha = refData.object.sha;
    const { data: commitData } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const parentTree = commitData.tree.sha;
    const { data: treeData } = await octo.rest.git.createTree({
      owner,
      repo,
      base_tree: parentTree,
      tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }],
    });
    const { data: newCommit } = await octo.rest.git.createCommit({
      owner,
      repo,
      message: `chore: add AI blog post for ${dateObj.toISOString().slice(0, 10)}`,
      tree: treeData.sha,
      parents: [baseSha],
    });
    await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
  } catch (err) {
    console.error('❌ GitHub error:', err.status || err.message || err);
    return res.status(500).send(`Error committing to GitHub: ${err.message}`);
  }

  return res.status(200).send('Blog generated ✅');
}
