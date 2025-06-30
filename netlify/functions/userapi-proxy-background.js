const fetch = require('node-fetch');
const Busboy = require('busboy');

const IMG_BB_API_KEY = '7a566f5e8bf791553a496e3c7c9e73c1'; // <-- your ImgBB key
const USERAPI_API_KEY = '76e6b884-9275-4b19-9ffc-71ec5a57dd69'; // <-- your UserAPI.ai API key
const ACCOUNT_HASH = 'ed8e5870-34c1-4674-9c88-7af403a034e3'; // <-- your UserAPI.ai account hash

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse incoming form-data with Busboy
  const busboy = Busboy({ headers: event.headers });
  let fileBuffer = [];
  let fileType = '';
  let fileName = '';

  await new Promise((resolve, reject) => {
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      fileType = mimetype;
      fileName = filename;
      file.on('data', data => fileBuffer.push(data));
    });
    busboy.on('finish', resolve);
    busboy.on('error', reject);
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });

  if (fileBuffer.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No image uploaded' }) };
  }

  const imageData = Buffer.concat(fileBuffer).toString('base64');

  // Upload to ImgBB
  let imgbbResp, imgbbJson;
  try {
    imgbbResp = await fetch(`https://api.imgbb.com/1/upload?key=${IMG_BB_API_KEY}`, {
      method: 'POST',
      body: new URLSearchParams({ image: imageData }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    imgbbJson = await imgbbResp.json();
  } catch (e) {
    console.error('ImgBB upload failed:', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'ImgBB upload failed', details: e.message }) };
  }

  if (!imgbbJson || !imgbbJson.success || !imgbbJson.data || !imgbbJson.data.url) {
    console.error('ImgBB error response:', imgbbJson);
    return { statusCode: 500, body: JSON.stringify({ error: 'Image upload to ImgBB failed', imgbbJson }) };
  }

  const imageUrl = imgbbJson.data.url;

  // Build the v7 OmniReference prompt
  const prompt = `${imageUrl} <omni-reference> knight in ornate medieval armor in a fantasy castle, ultra photorealistic, masterpiece, realistic lighting --v 7 --style raw --ar 1:1 --quality 1 --no cartoon, painting, illustration, anime, stylized face, stylized body, ai artifact, duplicate, extra arms, extra legs, missing limbs, watermark, text, extra fingers, rendered, avatar, low quality, filter, smoothing, smoothing skin, smoothing face, exaggerated features, photobash, composite, new pose, altered face, altered person, different person, race change, ethnicity change, gender change`;

  // Submit to UserAPI.ai (MidJourney proxy)
  let userApiResp, userApiText, userApiJson;
  try {
    userApiResp = await fetch('https://userapi.ai/api/discord/submit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${USERAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        account_hash: ACCOUNT_HASH,
        prompt: prompt,
        type: 'imagine'
      })
    });
    userApiText = await userApiResp.text();
    try {
      userApiJson = JSON.parse(userApiText);
    } catch (err) {
      console.error('UserAPI.ai did not return JSON:', userApiText);
      return { statusCode: 500, body: JSON.stringify({ error: 'UserAPI.ai did not return JSON', userApiText }) };
    }
    if (!userApiJson.hash) {
      console.error('UserAPI.ai error:', userApiJson);
      return { statusCode: 500, body: JSON.stringify({ error: 'UserAPI.ai did not return hash', userApiJson }) };
    }
  } catch (e) {
    console.error('UserAPI.ai error:', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'UserAPI.ai error', details: e.message }) };
  }

  // Poll for the result (waits for up to 35 seconds)
  let resultUrl = null, result = null;
  for (let i = 0; i < 7; i++) {
    try {
      await new Promise(res => setTimeout(res, 5000));
      const statusResp = await fetch('https://userapi.ai/api/discord/job', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${USERAPI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          account_hash: ACCOUNT_HASH,
          hash: userApiJson.hash
        })
      });
      const statusText = await statusResp.text();
      let statusJson;
      try {
        statusJson = JSON.parse(statusText);
      } catch (err) {
        console.error('UserAPI.ai status not JSON:', statusText);
        break;
      }
      if (statusJson.status === 'done' && statusJson.result && statusJson.result.url) {
        resultUrl = statusJson.result.url;
        result = statusJson.result;
        break;
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }

  if (!resultUrl) {
    return { statusCode: 202, body: JSON.stringify({ error: 'Image not ready yet, try again later.' }) };
  }

  // Return the final image to the frontend
  return {
    statusCode: 200,
    body: JSON.stringify({ resultUrl, result })
  };
};
