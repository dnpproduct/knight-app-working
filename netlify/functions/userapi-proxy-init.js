const Busboy = require('busboy');
const fetch = require('node-fetch');
const FormData = require('form-data');

const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";
const USERAPI_API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const DISCORD_WEBHOOK_URL = ""; // <-- IF you have a Discord webhook, paste it here (leave as "" if not)

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }
  const contentType = event.headers['content-type'] || event.headers['Content-Type'];
  if (!contentType || !contentType.startsWith('multipart/form-data')) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid content type, expected multipart/form-data" }) };
  }

  try {
    return await new Promise((resolve, reject) => {
      const busboy = new Busboy({ headers: { 'content-type': contentType } });
      let uploadBuffer = null;
      let promptText = "";

      busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        if (fieldname === 'image') {
          const chunks = [];
          file.on('data', data => chunks.push(data));
          file.on('end', () => {
            uploadBuffer = Buffer.concat(chunks);
          });
        } else {
          file.resume();
        }
      });

      busboy.on('field', (fieldname, value) => {
        if (fieldname === 'prompt') {
          promptText = value;
        }
      });

      busboy.on('error', err => {
        reject({ statusCode: 500, body: JSON.stringify({ error: "Failed to parse form data", details: err.message }) });
      });

      busboy.on('finish', async () => {
        if (!uploadBuffer || !promptText) {
          resolve({ statusCode: 400, body: JSON.stringify({ error: "Missing image or prompt" }) });
          return;
        }
        try {
          // 1. Upload to ImgBB
          const form = new FormData();
          form.append('image', uploadBuffer.toString('base64'));
          const imgbbUrl = `https://api.imgbb.com/1/upload?expiration=600&key=${IMGBB_API_KEY}`;
          const imgbbRes = await fetch(imgbbUrl, { method: 'POST', body: form, headers: form.getHeaders() });
          const imgbbData = await imgbbRes.json();
          const imageUrl = imgbbData.data?.url;
          if (!imageUrl) {
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Image upload failed", details: imgbbData.error?.message || "No URL returned" }) });
            return;
          }

          // 2. Send to UserAPI/Midjourney
          const finalPrompt = `${promptText} --oref ${imageUrl} --ow 500 --v 7`;
          const imagineRes = await fetch('https://api.userapi.ai/midjourney/v2/imagine', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': USERAPI_API_KEY
            },
            body: JSON.stringify({ prompt: finalPrompt })
          });
          const imagineData = await imagineRes.json();
          const jobHash = imagineData.hash;
          if (!jobHash) {
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Failed to start image generation", details: imagineData }) });
            return;
          }

          // 3. Start background polling (fires and forgets)
          try {
            const siteUrl = process.env.URL || process.env.DEPLOY_URL || `http://localhost:${process.env.PORT || 8888}`;
            await fetch(`${siteUrl}/.netlify/functions/userapi-proxy-background`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hash: jobHash, prompt: promptText, imageUrl: imageUrl })
            });
          } catch (bgErr) {}

          // 4. Return jobId
          resolve({ statusCode: 200, body: JSON.stringify({ jobId: jobHash }) });
        } catch (err) {
          resolve({ statusCode: 500, body: JSON.stringify({ error: "Internal server error", details: err.message }) });
        }
      });

      const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
      busboy.end(body);
    });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: e.message }) };
  }
};
