// api/generate.mjs

import Groq from 'groq-sdk';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // 1️⃣ CONFIGURE your topic here:
  const topic = 'Business and Artificial Intelligence News and Current Updates';

  // 2️⃣ Load env vars
  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner   = 'pancham555';      // ◀️ your GitHub username
  const repo    = 'cron-ai-blog-portfolio';
  const branch  = 'master';            // ◀️ your default branch

  if (!groqKey || !ghToken) {
    return res
      .status(500)
      .send('Error: GROQ_API_KEY and GITHUB_TOKEN must be set');
  }

  // ─── 1. Generate the full post via Groq chat API ──────────────────
  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });
    const completion = await client.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful blog-writing assistant.' },
        { role: 'user',   content: `Write an ~800-word blog post about: ${topic}` }
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

  // ─── 2. Prepare frontmatter fields ────────────────────────────────
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric'
  });  // e.g. "Jul 08, 2025"
  
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // description = first paragraph
  const firstPara = aiText.split(/\n\s*\n/)[0].replace(/'/g, "\\'");

  // pick a random icon between 1-10
  const icon = String(Math.floor(Math.random() * 10) + 1);

  // find images in src/assets/
  let heroImage = '';
  try {
    const assetsDir = path.resolve(process.cwd(), 'src/assets');
    const files = fs.readdirSync(assetsDir)
      .filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
    heroImage = files.length
      ? `/src/assets/${files[0]}`
      : '';
  } catch {
    heroImage = '';
  }

  // build the full markdown
  const filePath = `src/content/blog/${dateObj.toISOString().slice(0,10)}-${slug}.md`;
  const markdown = `---
title: '${topic}'
description:  '
${firstPara}
'
icon: '${icon}'
pubDate: '${pubDate}'
heroImage: '${heroImage}'
---

${aiText}
`;

  // ─── 3. Commit to GitHub via REST API ─────────────────────────────
  try {
    const octo = new Octokit({ auth: ghToken });

    // 3.1 Get latest commit SHA on branch
    const { data: refData } = await octo.rest.git.getRef({
      owner, repo, ref: `heads/${branch}`
    });
    const baseSha = refData.object.sha;

    // 3.2 Get its tree SHA
    const { data: commitData } = await octo.rest.git.getCommit({
      owner, repo, commit_sha: baseSha
    });
    const parentTree = commitData.tree.sha;

    // 3.3 Create new tree with our blob
    const { data: treeData } = await octo.rest.git.createTree({
      owner, repo,
      base_tree: parentTree,
      tree: [{
        path: filePath,
        mode: '100644',
        type: 'blob',
        content: markdown,
      }],
    });

    // 3.4 Create commit
    const { data: newCommit } = await octo.rest.git.createCommit({
      owner, repo,
      message: `chore: add AI blog post for ${dateObj.toISOString().slice(0,10)}`,
      tree: treeData.sha,
      parents: [baseSha],
    });

    // 3.5 Update branch ref
    await octo.rest.git.updateRef({
      owner, repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

  } catch (err) {
    console.error('❌ GitHub error status:', err.status || err.response?.status);
    console.error('❌ GitHub error data:', JSON.stringify(err.response?.data, null, 2));
    return res
      .status(500)
      .send(`Error committing to GitHub: ${err.message}`);
  }

  // Success!
  return res.status(200).send('Blog generated ✅');
}
