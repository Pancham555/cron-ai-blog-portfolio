// api/generate.mjs

import Groq from 'groq-sdk';
import { Octokit } from 'octokit';

export default async function handler(req, res) {
  const topic = 'Business and Artificial Intelligence News and Current Updates'; // ◀️ your topic
  const groqKey = process.env.GROQ_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  const owner = 'pancham555';      // ◀️ your GitHub username
  const repo  = 'cron-ai-blog-portfolio';

  if (!groqKey || !ghToken) {
    return res
      .status(500)
      .send('GROQ_API_KEY and GITHUB_TOKEN must be set');
  }

  // ─── 1. Generate with the text completions endpoint ─────────────────
  let aiText = '';
  try {
    const client = new Groq({ apiKey: groqKey });

    const completion = await client.completions.create({
      model: 'llama3-8b-8192',         // known-valid Groq model
      prompt: `Write an ~800-word blog post about: ${topic}`,
      max_tokens: 1200,               // ~800 words
      temperature: 0.7,
    });

    // `completion.choices[0].text` holds the plain-text reply
    aiText = completion.choices?.[0]?.text?.trim() || '';
    if (!aiText) {
      throw new Error('Empty text returned from Groq AI');
    }

  } catch (err) {
    console.error('❌ Groq AI error:', err.response?.data || err.message || err);
    return res.status(500).send(`Error generating content: ${err.message}`);
  }

  // ─── 2. Build Markdown ───────────────────────────────────────────────
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

  // ─── 3. Commit to GitHub ────────────────────────────────────────────
  try {
    const octo = new Octokit({ auth: ghToken });

    // Get latest commit on main
    const { data: refData } = await octo.rest.git.getRef({
      owner, repo, ref: 'heads/main'
    });
    const baseSha = refData.object.sha;

    // Get its tree
    const { data: commitData } = await octo.rest.git.getCommit({
      owner, repo, commit_sha: baseSha
    });
    const parentTree = commitData.tree.sha;

    // Create a new blob/tree for our file
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

    // Create commit
    const { data: newCommit } = await octo.rest.git.createCommit({
      owner, repo,
      message: `chore: add AI blog post for ${date}`,
      tree: treeData.sha,
      parents: [baseSha],
    });

    // Update the ref to point to new commit
    await octo.rest.git.updateRef({
      owner, repo,
      ref: 'heads/main',
      sha: newCommit.sha,
    });

  } catch (err) {
    console.error('❌ GitHub API error:', err);
    return res.status(500).send('Error committing to GitHub');
  }

  // Success
  return res.status(200).send('Blog generated ✅');
}
