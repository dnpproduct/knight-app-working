const fetch = require('node-fetch');
const USERAPI_API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const DISCORD_WEBHOOK_URL = ""; // <-- Fill in if you want Discord posts

exports.handler = async (event, context) => {
  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const jobHash = payload.hash;
    const promptText = payload.prompt || "";
    if (!jobHash) return { statusCode: 400, body: "No job hash provided" };

    const statusUrl = `https://api.userapi.ai/midjourney/v2/status?hash=${jobHash}`;
    let resultUrl = null;
    let status = null;
    let progress = 0;
    const startTime = Date.now();
    const timeoutMs = 60000;

    while (Date.now() - startTime < timeoutMs) {
      const statusRes = await fetch(statusUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'api-key': USERAPI_API_KEY }
      });
      const statusData = await statusRes.json();
      status = statusData.status;
      progress = statusData.progress;
      if (status === 'done' && statusData.result) {
        resultUrl = statusData.result.url || null;
        break;
      }
      if (status === 'failed' || status === 'blocked' || status === 'error') break;
      await new Promise(r => setTimeout(r, 2000));
    }

    // Post to Discord if webhook set
    if (resultUrl && DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith('http')) {
      await fetch(DISCORD_WEBHOOK_URL + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `**Prompt:** ${promptText}\n${resultUrl}`
        })
      });
    }

    // Also post errors if set
    if (!resultUrl && DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith('http')) {
      let errorMsg = "Image generation timed out.";
      if (status === 'blocked') errorMsg = 'Prompt was blocked by Midjourney content filter.';
      if (status === 'failed' || status === 'error') errorMsg = 'Image generation failed.';
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `**Prompt:** ${promptText}\nResult: ${errorMsg}` })
      });
    }

    return { statusCode: 200, body: "Completed" };
  } catch (err) {
    return { statusCode: 200, body: "Error handled" };
  }
};
