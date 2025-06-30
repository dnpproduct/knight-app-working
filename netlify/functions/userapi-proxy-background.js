// netlify/functions/userapi-proxy-background.js
const Busboy = require('busboy');
const fetch = require('node-fetch');

const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";
const USERAPI_API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const ACCOUNT_HASH = "ed8e5870-34c1-4674-9c88-7af403a034e3";

exports.handler = async function(event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    // Parse multipart form (image)
    const buffers = [];
    let fileName, mimeType;
    const busboy = Busboy({ headers: event.headers });
    let fileDone = false;
    let resolveForm, rejectForm;
    const formPromise = new Promise((resolve, reject) => {
      resolveForm = resolve; rejectForm = reject;
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      fileName = filename; mimeType = mimetype;
      file.on('data', data => buffers.push(data));
      file.on('end', () => { fileDone = true; });
    });
    busboy.on('finish', () => resolveForm());
    busboy.on('error', err => rejectForm(err));
    busboy.end(Buffer.from(event.body, 'base64'));
    await formPromise;
    if (!fileDone) throw new Error("No image uploaded.");
    const fileBuffer = Buffer.concat(buffers);

    // Upload to ImgBB
    const base64Img = fileBuffer.toString('base64');
    const imgbbResp = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `image=${encodeURIComponent(base64Img)}`
    });
    const imgbbJson = await imgbbResp.json();
    if (!imgbbJson.success) throw new Error("Image upload to imgbb failed: " + JSON.stringify(imgbbJson));
    const imgbbUrl = imgbbJson.data.url;

    // Build Midjourney v7 prompt with omni-ref
    const prompt = `${imgbbUrl} <omni-reference>
Ultra photorealistic. Keep the subject's face, skin, eyes, mouth, ears, hair, facial structure, ethnicity, gender, and unique physical features 100% identical to the input photo with no changes. Do not alter or stylize the face, head, body, or proportions. Only change clothing to ornate medieval knight armor and change the background to a cinematic, realistic epic fantasy castle scene. The image must look exactly like the real person in the photo, not a painting or drawing. No artistic filter. No changes to the subject's pose, angle, or perspective. High detail. Masterpiece. Real light. --v 7 --no different person, different face, altered face, stylized face, cartoon, painting, illustration, anime, ai artifact, bad anatomy, duplicate, face swap, new pose, extra arms, extra legs, missing limbs, watermark, text, extra fingers, rendered, avatar, low quality, filter, smoothing, smoothing skin, smoothing face, exaggerated features, photobash, composite
`;

    // Send to UserAPI.ai (Midjourney v7, omni-ref)
    const userApiResp = await fetch("https://dashboard.userapi.ai/api/discord/mj/task/imagine", {
      method: "POST",
      headers: {
        "Authorization": USERAPI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        account_hash: ACCOUNT_HASH,
        prompt
      })
    });
    const userApiJson = await userApiResp.json();
    if (!userApiJson.hash) throw new Error("UserAPI.ai error: " + JSON.stringify(userApiJson));

    // Poll for result (up to 45s)
    let resultUrl = null, pollCount = 0;
    while (pollCount < 20 && !resultUrl) {
      await new Promise(res => setTimeout(res, 2500));
      const pollResp = await fetch("https://dashboard.userapi.ai/api/discord/mj/task/status", {
        method: "POST",
        headers: {
          "Authorization": USERAPI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ account_hash: ACCOUNT_HASH, hash: userApiJson.hash })
      });
      const pollJson = await pollResp.json();
      if (pollJson && pollJson.result && pollJson.result.url) {
        resultUrl = pollJson.result.url;
        break;
      }
      pollCount++;
    }
    if (!resultUrl) throw new Error("Timeout waiting for image from UserAPI.ai. Check Discord for completion.");

    // Return result
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: resultUrl })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || String(err) })
    };
  }
};
