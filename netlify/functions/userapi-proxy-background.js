// netlify/functions/userapi-proxy-background.js
const fetch = require('node-fetch');
const Busboy = require('busboy');
const IMG_API = '7a566f5e8bf791553a496e3c7c9e73c1'; // ImgBB API Key
const USER_API = '76e6b884-9275-4b19-9ffc-71ec5a57dd69'; // UserAPI.ai API Key
const ACCOUNT_HASH = 'ed8e5870-34c1-4674-9c88-7af403a034e3';

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: event.headers });
    let fileData = [];
    let fileType = '';
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      fileType = mimetype;
      file.on('data', data => fileData.push(data));
    });

    busboy.on('finish', async () => {
      try {
        // Upload to ImgBB
        const imageBuffer = Buffer.concat(fileData);
        const imageBase64 = imageBuffer.toString('base64');
        const imgResp = await fetch(`https://api.imgbb.com/1/upload?key=${IMG_API}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `image=${encodeURIComponent(imageBase64)}`
        });
        const imgData = await imgResp.json();
        if (!imgData.success) throw new Error("Image upload to imgbb failed.");

        const refUrl = imgData.data.url;

        // ---- OMNI REFERENCE PROMPT & PAYLOAD ----
        const prompt = "Ultra photorealistic. Transform the person(s) into ornate medieval knight armor, standing in front of a realistic epic fantasy castle background. Do NOT alter, stylize, or change their face, head, body, pose, skin, ethnicity, gender, or any unique physical features. The image must look exactly like the real people in the reference image, not a painting or drawing. No artistic filter. --v 7.0 --no different person, different face, altered face, stylized face, cartoon, painting, illustration, anime, ai artifact, bad anatomy, duplicate, face swap, new pose, extra arms, extra legs, missing limbs, watermark, text, extra fingers, rendered, avatar, low quality, filter, smoothing, smoothing skin, smoothing face, exaggerated features, photobash, composite";

        // Compose payload for UserAPI.ai imagine
        const imagineBody = {
          prompt,
          account_hash: ACCOUNT_HASH,
          version: "v7", // v7 for Midjourney v7
          reference_urls: [refUrl], // <<<< OMNI REFERENCE
          aspect_ratio: "1:1"
        };

        // Send to UserAPI.ai
        const mjResp = await fetch('https://api.userapi.ai/v1/midjourney/imagine', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${USER_API}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(imagineBody)
        });
        const mjData = await mjResp.json();
        if (!mjData.hash) throw new Error("UserAPI.ai failed: " + JSON.stringify(mjData));

        // Poll for result
        let resultImage = null, pollCount = 0;
        while (pollCount++ < 40) {
          await new Promise(r => setTimeout(r, 2500));
          const poll = await fetch('https://api.userapi.ai/v1/midjourney/status', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${USER_API}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hash: mjData.hash, account_hash: ACCOUNT_HASH })
          });
          const pollData = await poll.json();
          if (pollData.result && pollData.result.url) {
            resultImage = pollData.result.url;
            break;
          }
        }
        if (!resultImage) throw new Error("Timeout waiting for generation result.");

        resolve({
          statusCode: 200,
          body: JSON.stringify({ imageUrl: resultImage }),
          headers: { "Content-Type": "application/json" }
        });

      } catch (e) {
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: e.message }),
          headers: { "Content-Type": "application/json" }
        });
      }
    });
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};
