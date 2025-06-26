// api/generate.ts

import Groq from 'groq-sdk';            // default import as per npm docs :contentReference[oaicite:0]{index=0}
import { Octokit } from 'octokit';

export default async function handler(req: any, res: any) {
  const topic = 'Current Business News and AI';       // ◀️ change this
  const groqKey = process.env.GROQ_API_KEY!;
  const ghToken = process.env.GITHUB_TOKEN!;
  const owner = 'pancham555';                     // ◀️ your GitHub username
  const repo = 'cron-ai-blog-portfolio';

  // ─── 1. Generate content via groq-sdk ──────────────────────
  const client = new Groq({ apiKey: groqKey });
  let aiText: string;

  try {
    const completion = await client.chat.completions.create({
      model: 'groq-3',
      messages: [
        { role: 'system', content: 'You are a helpful blog-writing assistant.' },
        { role: 'user',   content: `Write a ~750-word blog post about: ${topic}` }
      ],
      max_tokens: 600,
      temperature: 0.7,
    });
    aiText = completion?.choices?.[0]?.message?.content?.trim()??"";
  } catch (err) {
    console.error('Groq AI error:', err);
    return res.status(500).send('Error generating content');
  }

  // ─── 2. Build Markdown ───────────────────────────────────────
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

  // ─── 3. Commit via GitHub API ────────────────────────────────
  const octo = new Octokit({ auth: ghToken });

  // 3.1 Get latest commit SHA on main
  const { data: refData } = await octo.rest.git.getRef({
    owner, repo,
    ref: 'heads/main'
  });
  const baseSha = refData.object.sha;

  // 3.2 Get its tree
  const { data: commitData } = await octo.rest.git.getCommit({
    owner, repo,
    commit_sha: baseSha
  });
  const parentTree = commitData.tree.sha;

  // 3.3 Create new tree with our blog file
  const { data: treeData } = await octo.rest.git.createTree({
    owner, repo,
    base_tree: parentTree,
    tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }]
  });

  // 3.4 Create the commit
  const { data: newCommit } = await octo.rest.git.createCommit({
    owner, repo,
    message: `chore: add AI blog post for ${date}`,
    tree: treeData.sha,
    parents: [baseSha]
  });

  // 3.5 Update the ref
  await octo.rest.git.updateRef({
    owner, repo,
    ref: 'heads/main',
    sha: newCommit.sha
  });

  return res.status(200).send('Blog generated ✅');
}
