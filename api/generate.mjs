// api/generate.mjs

import Groq from 'groq-sdk';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  const baseTopic = 'Business and Artificial Intelligence News and Current Updates';

  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner   = 'pancham555';
  const repo    = 'cron-ai-blog-portfolio';
  const branch  = 'master';

  if (!groqKey || !ghToken) {
    return res.status(500).send('Error: GROQ_API_KEY and GITHUB_TOKEN must be set');
  }

  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful blog-writing assistant.' },
        { role: 'user', content: `Write an ~800-word blog post about: ${baseTopic}. Keep it concise and focused—avoid filler phrases like ‘Here’s…’, ‘In this post…’, or other introductory lead-ins.` }
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

  let dynamicTitle = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const titleCompletion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are an expert headline writer.' },
        { role: 'user', content: `Provide a concise, 6-word max title that clearly reflects the topic: "${baseTopic}". Only return the title text without markdown or intros.` }
      ],
      max_tokens: 20,
      temperature: 0.5,
    });
    dynamicTitle = titleCompletion.choices[0].message.content.trim();
    dynamicTitle = dynamicTitle.replace(/\*/g, '').replace(/['"]/g, '');
    if (!dynamicTitle) dynamicTitle = baseTopic;
  } catch (err) {
    console.error('❌ Title AI error:', err.message || err);
    dynamicTitle = baseTopic;
  }

  let dynamicDescription = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const descCompletion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a professional copywriter.' },
        { role: 'user', content: `Write a pure, 12-word max summary for a blog post on "${baseTopic}". No markdown, no intro phrases—just the summary.` }
      ],
      max_tokens: 30,
      temperature: 0.7,
    });
    dynamicDescription = descCompletion.choices[0].message.content.trim();
    dynamicDescription = dynamicDescription.replace(/Here is.*?:\s*/i, '').replace(/\*/g, '').replace(/['\"]/g, '');
    if (!dynamicDescription) {
      const firstParaRaw = aiText.split(/\n\s*\n/)[0].trim();
      dynamicDescription = firstParaRaw.split(' ').slice(0,12).join(' ');
    }
  } catch (err) {
    console.error('❌ Description AI error:', err.message || err);
    const firstParaRaw = aiText.split(/\n\s*\n/)[0].trim();
    dynamicDescription = firstParaRaw.split(' ').slice(0,12).join(' ');
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

  const filePath = `src/content/blog/${dateObj.toISOString().slice(0,10)}-${slug}.md`;
  const markdown = `---
  title: '${dynamicTitle}'
  description: '${dynamicDescription}'
  icon: '${icon}'
  pubDate: '${pubDate}'
  heroImage: '${heroImage}'
---

${aiText}
`;

  try {
    const octo = new Octokit({ auth: ghToken });
    const { data: refData } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseSha = refData.object.sha;
    const { data: commitData } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const parentTree = commitData.tree.sha;
    const { data: treeData } = await octo.rest.git.createTree({
      owner, repo, base_tree: parentTree,
      tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }],
    });
    const { data: newCommit } = await octo.rest.git.createCommit({
      owner, repo, message: `chore: add AI blog post for ${dateObj.toISOString().slice(0,10)}`,
      tree: treeData.sha, parents: [baseSha],
    });
    await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
  } catch (err) {
    console.error('❌ GitHub error:', err.status || err.message || err);
    return res.status(500).send(`Error committing to GitHub: ${err.message}`);
  }

  return res.status(200).send('Blog generated ✅');
}
