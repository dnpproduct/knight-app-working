const fetch = require('node-fetch');
const FormData = require('form-data');
const Busboy = require('busboy');

// ====== Insert your real API values here ======
const API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const ACCOUNT_HASH = "ed8e5870-34c1-4674-9c88-7af403a034e3";
const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";
// ==============================================

const POSITIVE_PROMPT = "Ultra photorealistic. Keep the subject's face, skin, eyes, mouth, ears, hair, facial structure, ethnicity, gender, and unique physical features 100% identical to the input photo with no changes. Do not alter or stylize the face, head, body, or proportions. Only change clothing to ornate medieval knight armor and change the background to a cinematic, realistic epic fantasy castle scene. The image must look exactly like the real person in the photo, not a painting or drawing. No artistic filter. No changes to the subject's pose, angle, or perspective. High detail. Masterpiece. Real light.";
const NEGATIVE_PROMPT = "different person, different face, altered face, stylized face, cartoon, painting, illustration, anime, ai artifact, bad anatomy, duplicate, face swap, new pose, extra arms, extra legs, missing limbs, watermark, text, extra fingers, rendered, avatar, low quality, filter, smoothing, smoothing skin, smoothing face, exaggerated features, photobash, composite";

// --- Upload to imgbb ---
async function uploadToImgBB(imageBuffer) {
  const form = new FormData();
  form.append('key', IMGBB_API_KEY);
  form.append('image', imageBuffer.toString('base64'));
  const res = await fetch('https://api.imgbb.com/1/upload', { method: "POST", body: form });
  const data = await res.json();
  if (!data.success) throw new Error("Image upload to imgbb failed: " + JSON.stringify(data));
  return data.data.url;
}

exports.handler = function(event, context, callback) {
  console.log("Function started");
  if (event.httpMethod !== "POST") {
    console.log("Method not allowed");
    return callback(null, { statusCode: 405, body: "Method Not Allowed" });
  }

  const busboy = Busboy({ headers: event.headers });
  let fileBuffer = Buffer.alloc(0);
  let fileFound = false;

  busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
    fileFound = true;
    file.on('data', function(data) { fileBuffer = Buffer.concat([fileBuffer, data]); });
  });
  busboy.on('finish', async function() {
    try {
      console.log("Busboy finished parsing");
      if (!fileFound || fileBuffer.length === 0) {
        console.log("Image not found in upload");
        return callback(null, {
          statusCode: 400,
          body: JSON.stringify({ error: "Image not found in upload." })
        });
      }

      // Step 1: Upload to imgbb
      console.log("Uploading image to imgbb...");
      const imageUrl = await uploadToImgBB(fileBuffer);
      console.log("Image uploaded to imgbb:", imageUrl);

      // Step 2: Compose prompt for V7
      const prompt = imageUrl + " " + POSITIVE_PROMPT + " --no " + NEGATIVE_PROMPT;
      const imagineBody = { prompt, account_hash: ACCOUNT_HASH, model_version: "v7" };

      // Step 3: POST to UserAPI.ai
      console.log("Sending prompt to UserAPI.ai:", prompt);
      const imagineResp = await fetch("https://api.userapi.ai/midjourney/v2/imagine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": API_KEY
        },
        body: JSON.stringify(imagineBody)
      });

      const imagineData = await imagineResp.json();
      console.log("UserAPI.ai response:", imagineData);

      if (!imagineData.hash) {
        console.log("No hash returned from UserAPI.ai");
        return callback(null, {
          statusCode: 500,
          body: JSON.stringify({ error: "UserAPI.ai did not return a hash: " + JSON.stringify(imagineData) })
        });
      }

      // Step 4: Poll for result
      let resultUrl = null, attempts = 0;
      while (attempts < 60) {
        console.log("Polling for result, attempt", attempts);
        await new Promise(r => setTimeout(r, 5000));
        const statusResp = await fetch(
          `https://api.userapi.ai/midjourney/v2/status?hash=${imagineData.hash}`,
          { headers: { "api-key": API_KEY } }
        );
        const statusData = await statusResp.json();
        console.log("Status data:", statusData);

        if (statusData.status === "done" && statusData.result && statusData.result.url) {
          resultUrl = statusData.result.url;
          break;
        }
        if (statusData.status === "error" || statusData.status === "failed") {
          return callback(null, {
            statusCode: 500,
            body: JSON.stringify({ error: "Image generation failed: " + (statusData.status_reason || statusData.status) })
          });
        }
        attempts++;
      }

      if (!resultUrl) {
        console.log("Timed out waiting for image generation");
        return callback(null, {
          statusCode: 500,
          body: JSON.stringify({ error: "Timed out waiting for image generation." })
        });
      }

      console.log("Returning result image:", resultUrl);
      callback(null, {
        statusCode: 200,
        body: JSON.stringify({ image: resultUrl })
      });

    } catch (err) {
      console.log("Exception:", err.message);
      callback(null, {
        statusCode: 500,
        body: JSON.stringify({ error: err.message })
      });
    }
  });
  busboy.end(Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8"));
};
