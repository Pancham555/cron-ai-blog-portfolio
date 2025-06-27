// api/generate.mjs

import Groq from 'groq-sdk';
import { Octokit } from 'octokit';

export default async function handler(req, res) {
  // ◀️ EDIT: set your desired topic here
  const topic = 'Business and Artificial Intelligence News and Current Updates';

  // Env vars from Vercel
  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner   = 'pancham555';      // ◀️ EDIT to your GitHub username
  const repo    = 'cron-ai-blog-portfolio';
  const branch  = 'master';            // ◀️ EDIT if your default branch is not "main"

  if (!groqKey || !ghToken) {
    return res
      .status(500)
      .send('Error: GROQ_API_KEY and GITHUB_TOKEN must be set');
  }

  // ─── 1. Generate content via groq-sdk (chat API) ────────────────────
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
    if (!aiText) {
      throw new Error('Received empty response from Groq AI');
    }
  } catch (err) {
    console.error('❌ Groq AI error:', err.response?.data || err.message || err);
    return res.status(500).send(`Error generating content: ${err.message}`);
  }

  // ─── 2. Build Markdown file contents ───────────────────────────
  const date = new Date().toISOString().slice(0, 10);
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const filePath = `src/content/blog/${date}-${slug}.md`;
  const markdown = `---
title: "AI-Written: ${topic}"
date: "${new Date().toISOString()}"
---

${aiText}
`;

  // ─── 3. Commit to GitHub via REST API ──────────────────────────
  try {
    const octo = new Octokit({ auth: ghToken });

    // 3.1 Get the latest commit SHA on branch
    const { data: refData } = await octo.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });
    const baseSha = refData.object.sha;

    // 3.2 Get its tree SHA
    const { data: commitData } = await octo.rest.git.getCommit({
      owner,
      repo,
      commit_sha: baseSha
    });
    const parentTree = commitData.tree.sha;

    // 3.3 Create a new tree with our blog file blob
    const { data: treeData } = await octo.rest.git.createTree({
      owner,
      repo,
      base_tree: parentTree,
      tree: [{
        path: filePath,
        mode: '100644',
        type: 'blob',
        content: markdown,
      }],
    });

    // 3.4 Create a new commit pointing to that tree
    const { data: newCommit } = await octo.rest.git.createCommit({
      owner,
      repo,
      message: `chore: add AI blog post for ${date}`,
      tree: treeData.sha,
      parents: [baseSha],
    });

    // 3.5 Update branch to point at the new commit
    await octo.rest.git.updateRef({
      owner,
      repo,
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
