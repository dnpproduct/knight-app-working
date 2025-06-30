const fetch = require('node-fetch');
const USERAPI_API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }
  const jobHash = event.queryStringParameters?.hash;
  if (!jobHash) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing job hash" }) };
  }
  try {
    const statusRes = await fetch(`https://api.userapi.ai/midjourney/v2/status?hash=${jobHash}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'api-key': USERAPI_API_KEY }
    });
    const data = await statusRes.json();
    const status = data.status;
    const progress = data.progress;
    if (status === 'done' && data.result?.url) {
      return { statusCode: 200, body: JSON.stringify({ done: true, imageUrl: data.result.url }) };
    }
    if (status === 'failed' || status === 'blocked' || status === 'error') {
      const reason = data.status_reason || (status === 'blocked' ? 'Content blocked by Midjourney' : 'Generation failed');
      return { statusCode: 200, body: JSON.stringify({ done: true, error: reason }) };
    }
    return { statusCode: 200, body: JSON.stringify({ done: false, progress: progress || 0, status: status }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Error checking status", details: err.message }) };
  }
};
