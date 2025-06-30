// netlify/functions/userapi-proxy-background.js
const fetch = require('node-fetch');
const Busboy = require('busboy');

const IMGBB_API_KEY = '7a566f5e8bf791553a496e3c7c9e73c1'; // your ImgBB key
const USERAPI_KEY = '76e6b884-9275-4b19-9ffc-71ec5a57dd69'; // your UserAPI key
const USERAPI_ACCOUNT_HASH = 'ed8e5870-34c1-4674-9c88-7af403a034e3'; // your account hash

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  return new Promise((resolve) => {
    const busboy = Busboy({ headers: event.headers });
    let fileData = [];
    let prompt = "";
    busboy.on('file', (fieldname, file) => {
      file.on('data', (data) => fileData.push(data));
    });
    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'prompt') prompt = val;
    });
    busboy.on('finish', async () => {
      try {
        // Upload image to ImgBB
        const imageBase64 = Buffer.concat(fileData).toString('base64');
        const imgbbResp = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
          method: 'POST',
          body: new URLSearchParams({ image: imageBase64 }),
        });
        const imgbbJson = await imgbbResp.json();
        if (!imgbbJson.data || !imgbbJson.data.url) {
          return resolve({
            statusCode: 500,
            body: JSON.stringify({ success: false, error: "Image upload failed." }),
          });
        }
        const imageUrl = imgbbJson.data.url;

        // Compose UserAPI imagine call (MJ v7, omni reference)
        const imaginePayload = {
          account_hash: USERAPI_ACCOUNT_HASH,
          prompt: imageUrl + " " + prompt,
          params: {
            v: 7,
            mode: "relaxed",
            omni_reference: true,
          }
        };
        const userapiResp = await fetch('https://api.userapi.ai/v2/midjourney/imagine', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + USERAPI_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(imaginePayload),
        });
        const userapiJson = await userapiResp.json();
        if (!userapiJson.hash) {
          return resolve({
            statusCode: 500,
            body: JSON.stringify({ success: false, error: "Failed to create image. (UserAPI)" }),
          });
        }
        // Poll for result (max 40s)
        let tries = 0, resultImage = null;
        while (tries++ < 20) {
          await new Promise(res => setTimeout(res, 2000));
          const statusResp = await fetch('https://api.userapi.ai/v2/midjourney/status', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + USERAPI_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              account_hash: USERAPI_ACCOUNT_HASH,
              hash: userapiJson.hash
            }),
          });
          const statusJson = await statusResp.json();
          if (statusJson.status === "done" && statusJson.result && statusJson.result.url) {
            resultImage = statusJson.result.url;
            break;
          }
          // If failed, stop
          if (statusJson.status === "failed" || statusJson.status_reason) break;
        }
        if (!resultImage) {
          return resolve({
            statusCode: 500,
            body: JSON.stringify({ success: false, error: "Failed to get result image." }),
          });
        }
        // Done!
        resolve({
          statusCode: 200,
          body: JSON.stringify({ success: true, result: resultImage }),
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        resolve({
          statusCode: 500,
          body: JSON.stringify({ success: false, error: err.message })
        });
      }
    });
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};
