const fetch = require('node-fetch');
const FormData = require('form-data');
const Busboy = require('busboy');

const API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const ACCOUNT_HASH = "ed8e5870-34c1-4674-9c88-7af403a034e3";
const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";

const POSITIVE_PROMPT = "Photorealistic, identical face, skin, eyes, mouth, ears, hair, facial structure, ethnicity, gender, and unique features must remain unchanged, no stylization or alterations, clothing changed only to ornate medieval knight armor, background changed only to cinematic epic fantasy castle, must look like a real photo, not a drawing or painting, no filter, no smoothing, same pose and camera angle.";
const NEGATIVE_PROMPT = "do not change face, do not change skin, do not change hair, do not change pose, do not change camera angle, no different person, no altered face, no cartoon, no painting, no illustration, no anime, no ai artifact, no bad anatomy, no duplicate, no face swap, no new pose, no extra limbs, no missing limbs, no watermark, no text, no extra fingers, no rendered, no avatar, no smoothing, no exaggerated features, no photobash, no composite, no art style, no stylizing, no avatar, no race change";

async function uploadToImgBB(imageBuffer) {
  const form = new FormData();
  form.append('key', IMGBB_API_KEY);
  form.append('image', imageBuffer.toString('base64'));
  const res = await fetch('https://api.imgbb.com/1/upload', { method: "POST", body: form });
  const data = await res.json();
  if (!data.success) throw new Error("Image upload to imgbb failed: " + JSON.stringify(data));
  return data.data.url;
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Parse file upload using Busboy
  const busboy = Busboy({ headers: event.headers });
  let fileBuffer = Buffer.alloc(0);
  let fileFound = false;

  await new Promise((resolve, reject) => {
    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
      fileFound = true;
      file.on('data', function(data) { fileBuffer = Buffer.concat([fileBuffer, data]); });
    });
    busboy.on('finish', resolve);
    busboy.on('error', reject);
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8"));
  });

  if (!fileFound || fileBuffer.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Image not found in upload." }) };
  }

  try {
    const imageUrl = await uploadToImgBB(fileBuffer);

    // Compose prompt for V7
    const prompt = imageUrl + " " + POSITIVE_PROMPT + " --no " + NEGATIVE_PROMPT;
    const imagineBody = { prompt, account_hash: ACCOUNT_HASH, model_version: "v7" };

    // POST to UserAPI.ai
    const imagineResp = await fetch("https://api.userapi.ai/midjourney/v2/imagine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": API_KEY
      },
      body: JSON.stringify(imagineBody)
    });

    const imagineData = await imagineResp.json();
    if (!imagineData.hash) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "UserAPI.ai did not return a hash: " + JSON.stringify(imagineData) })
      };
    }

    // Poll for result, every 3 seconds for up to ~60s
    let resultUrl = null, attempts = 0;
    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusResp = await fetch(
        `https://api.userapi.ai/midjourney/v2/status?hash=${imagineData.hash}`,
        { headers: { "api-key": API_KEY } }
      );
      const statusData = await statusResp.json();
      if (statusData.status === "done" && statusData.result && statusData.result.url) {
        resultUrl = statusData.result.url;
        break;
      }
      if (statusData.status === "error" || statusData.status === "failed") {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Image generation failed: " + (statusData.status_reason || statusData.status) })
        };
      }
      attempts++;
    }

    if (!resultUrl) {
      return { statusCode: 504, body: JSON.stringify({ error: "Timed out waiting for image generation." }) };
    }

    // Return the result image in JSON
    return {
      statusCode: 200,
      body: JSON.stringify({ image: resultUrl })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
