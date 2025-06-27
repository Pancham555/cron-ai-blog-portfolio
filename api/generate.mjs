// // api/generate.mjs

// import Groq from 'groq-sdk';
// import { Octokit } from 'octokit';
// import fs from 'fs';
// import path from 'path';

// export default async function handler(req, res) {
//   // 1️⃣ CONFIGURE your base topic here:
//   const baseTopic = 'Business and Artificial Intelligence News and Current Updates';

//   // 2️⃣ Load env vars
//   const groqKey = process.env.GROQ_API_KEY;
//   const ghToken = process.env.GITHUB_TOKEN;
//   const owner   = 'pancham555';
//   const repo    = 'cron-ai-blog-portfolio';
//   const branch  = 'master';

//   if (!groqKey || !ghToken) {
//     return res
//       .status(500)
//       .send('Error: GROQ_API_KEY and GITHUB_TOKEN must be set');
//   }

//   // ─── 1. Generate the full post via Groq chat API ──────────────────
//   let aiText = '';
//   try {
//     const client = new Groq({ apiKey: groqKey });
//     const completion = await client.chat.completions.create({
//       model: 'llama3-8b-8192',
//       messages: [
//         { role: 'system', content: 'You are a helpful blog-writing assistant.' },
//         { role: 'user', content: `Write an ~800-word blog post about: ${baseTopic}` }
//       ],
//       max_tokens: 1200,
//       temperature: 0.7,
//     });
//     aiText = completion.choices[0].message.content.trim();
//     if (!aiText) throw new Error('Received empty response from Groq AI');
//   } catch (err) {
//     console.error('❌ Groq AI error:', err.response?.data || err.message || err);
//     return res.status(500).send(`Error generating content: ${err.message}`);
//   }

//   // ─── 2. Generate a dynamic title via Groq ─────────────────────────
//   let dynamicTitle = '';
//   try {
//     const client = new Groq({ apiKey: groqKey });
//     const titleCompletion = await client.chat.completions.create({
//       model: 'llama3-8b-8192',
//       messages: [
//         { role: 'system', content: 'You are an expert headline writer.' },
//         { role: 'user', content: `Provide a concise, engaging title (max 10 words) for the following blog post:\n\n${aiText}` }
//       ],
//       max_tokens: 30,
//       temperature: 0.5,
//     });
//     dynamicTitle = titleCompletion.choices[0].message.content.trim().replace(/'/g, "\\'");
//     if (!dynamicTitle) dynamicTitle = baseTopic;
//   } catch (err) {
//     console.error('❌ Title AI error:', err.message || err);
//     dynamicTitle = baseTopic;
//   }

//   // ─── 3. Generate a short description via Groq ───────────────────────
//   let dynamicDescription = '';
//   try {
//     const client = new Groq({ apiKey: groqKey });
//     const descCompletion = await client.chat.completions.create({
//       model: 'llama3-8b-8192',
//       messages: [
//         { role: 'system', content: 'You are a professional copywriter.' },
//         { role: 'user', content: `Write a single-sentence summary for a blog post:\n\n${aiText}` }
//       ],
//       max_tokens: 60,
//       temperature: 0.7,
//     });
//     dynamicDescription = descCompletion.choices[0].message.content.trim().replace(/'/g, "\\'");
//     if (!dynamicDescription) {
//       const firstParaRaw = aiText.split(/\n\s*\n/)[0].trim();
//       dynamicDescription = firstParaRaw.slice(0, 200);
//     }
//   } catch (err) {
//     console.error('❌ Description AI error:', err.message || err);
//     const firstParaRaw = aiText.split(/\n\s*\n/)[0].trim();
//     dynamicDescription = firstParaRaw.slice(0, 200);
//   }

//   // ─── 4. Prepare frontmatter fields ───────────────────────────────
//   const dateObj = new Date();
//   const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

//   const slug = dynamicTitle
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/(^-|-$)/g, '');

//   // pick a random icon between 1-5
//   const icon = String(Math.floor(Math.random() * 5) + 1);

//   // find a hero image in src/assets/
//   let heroImage = '';
//   try {
//     const assetsDir = path.resolve(process.cwd(), 'src/assets');
//     const files = fs.readdirSync(assetsDir).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
//     heroImage = files.length ? `/src/assets/${files[0]}` : '';
//   } catch {
//     heroImage = '';
//   }

//   // build the full markdown
//   const filePath = `src/content/blog/${dateObj.toISOString().slice(0,10)}-${slug}.md`;
//   const markdown = `---
//   title: '${dynamicTitle}'
//   description: '${dynamicDescription}'
//   icon: '${icon}'
//   pubDate: '${pubDate}'
//   heroImage: '${heroImage}'
// ---

// ${aiText}
// `;

//   // ─── 5. Commit to GitHub via REST API ─────────────────────────────
//   try {
//     const octo = new Octokit({ auth: ghToken });
//     const { data: refData } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
//     const baseSha = refData.object.sha;
//     const { data: commitData } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
//     const parentTree = commitData.tree.sha;
//     const { data: treeData } = await octo.rest.git.createTree({
//       owner, repo, base_tree: parentTree,
//       tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }],
//     });
//     const { data: newCommit } = await octo.rest.git.createCommit({
//       owner, repo, message: `chore: add AI blog post for ${dateObj.toISOString().slice(0,10)}`,
//       tree: treeData.sha, parents: [baseSha],
//     });
//     await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
//   } catch (err) {
//     console.error('❌ GitHub error:', err.status || err.message || err);
//     return res.status(500).send(`Error committing to GitHub: ${err.message}`);
//   }

//   // Success!
//   return res.status(200).send('Blog generated ✅');
// }

// api/generate.mjs

import { GoogleGenAI } from '@google/genai';
import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // 1️⃣ CONFIGURE your base topic here:
  const baseTopic = 'Business and Artificial Intelligence News and Current Updates';

  // 2️⃣ Load env vars
  const geminiKey = process.env.GEMINI_API_KEY;
  const ghToken   = process.env.GITHUB_TOKEN;
  const owner     = 'pancham555';      // ◀️ your GitHub username
  const repo      = 'cron-ai-blog-portfolio';
  const branch    = 'master';

  if (!geminiKey || !ghToken) {
    return res.status(500).send('Error: GEMINI_API_KEY and GITHUB_TOKEN must be set');
  }

  // Initialize Google Gen AI client
  const ai = new GoogleGenAI({ apiKey: geminiKey });

  // ─── 1. Generate the full post via Gemini API ─────────────────
  let aiText = '';
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [`Write an ~800-word blog post about: ${baseTopic}`],
    });
    aiText = response.text.trim();
    if (!aiText) throw new Error('Empty response from Gemini');
  } catch (err) {
    console.error('❌ Gemini error:', err);
    return res.status(500).send(`Error generating content: ${err.message || err}`);
  }

  // ─── 2. Generate a dynamic title via Gemini ───────────────────
  let dynamicTitle = '';
  try {
    const titleResp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [`Provide a concise, engaging title (max 10 words) for this blog post:\n\n${aiText}`],
    });
    dynamicTitle = titleResp.text.trim().replace(/'/g, "\\'");
    if (!dynamicTitle) dynamicTitle = baseTopic;
  } catch (err) {
    console.error('❌ Title error:', err);
    dynamicTitle = baseTopic;
  }

  // ─── 3. Generate a short description via Gemini ───────────────
  let dynamicDescription = '';
  try {
    const descResp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [`Write a single-sentence summary for this blog post:\n\n${aiText}`],
    });
    dynamicDescription = descResp.text.trim().replace(/'/g, "\\'");
    if (!dynamicDescription) {
      const firstPara = aiText.split(/\n\s*\n/)[0].trim();
      dynamicDescription = firstPara.slice(0, 200);
    }
  } catch (err) {
    console.error('❌ Description error:', err);
    const firstPara = aiText.split(/\n\s*\n/)[0].trim();
    dynamicDescription = firstPara.slice(0, 200);
  }

  // ─── 4. Prepare frontmatter ──────────────────────────────────
  const dateObj = new Date();
  const pubDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const slug = dynamicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const icon = String(Math.floor(Math.random() * 5) + 1);

  let heroImage = '';
  try {
    const files = fs.readdirSync(path.resolve(process.cwd(), 'src/assets')).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
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

  // ─── 5. Commit to GitHub ─────────────────────────────────────
  try {
    const octo = new Octokit({ auth: ghToken });
    const { data: refData } = await octo.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseSha = refData.object.sha;
    const { data: commitData } = await octo.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const parentTree = commitData.tree.sha;
    const { data: treeData } = await octo.rest.git.createTree({ owner, repo, base_tree: parentTree,
      tree: [{ path: filePath, mode: '100644', type: 'blob', content: markdown }],
    });
    const { data: newCommit } = await octo.rest.git.createCommit({ owner, repo,
      message: `chore: add AI blog post for ${dateObj.toISOString().slice(0,10)}`, tree: treeData.sha, parents: [baseSha],
    });
    await octo.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
  } catch (err) {
    console.error('❌ GitHub error:', err);
    return res.status(500).send(`Error committing to GitHub: ${err.message || err}`);
  }

  return res.status(200).send('Blog generated ✅');
}
