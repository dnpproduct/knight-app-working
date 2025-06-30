const fetch = require('node-fetch');
const FormData = require('form-data');
const Busboy = require('busboy');

const API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const ACCOUNT_HASH = "ed8e5870-34c1-4674-9c88-7af403a034e3";
const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";

const POSITIVE_PROMPT = "KEEP the original person's face, facial features, skin, body, hair, and unique identity unchanged. Only change their clothing to ornate medieval knight armor and their background to an epic fantasy castle with a dramatic sky. Ultra detailed, high quality, photorealistic, masterpiece, realistic lighting.";
const NEGATIVE_PROMPT = "changing face, different facial features, altered appearance, different skin tone, different person, face swap, cartoon, painting, illustration, blurry, distorted, bad anatomy, duplicate, extra arms, extra legs, missing limbs, watermark, text, extra fingers, uncanny, ai artifact";

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
  console.log("Function started");
  if (event.httpMethod !== "POST") {
    console.log("Method not allowed");
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const busboy = Busboy({ headers: event.headers });
  let fileBuffer = Buffer.alloc(0);
  let fileFound = false;

  return new Promise((resolve, reject) => {
    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
      fileFound = true;
      file.on('data', function(data) { fileBuffer = Buffer.concat([fileBuffer, data]); });
    });
    busboy.on('finish', async function() {
      try {
        console.log("Busboy finished parsing");
        if (!fileFound || fileBuffer.length === 0) {
          console.log("Image not found in upload");
          return resolve({
            statusCode: 400,
            body: JSON.stringify({ error: "Image not found in upload." })
          });
        }

        console.log("Uploading image to imgbb...");
        const imageUrl = await uploadToImgBB(fileBuffer);
        console.log("Image uploaded to imgbb:", imageUrl);

        // Build Midjourney prompt
        const prompt = imageUrl + " " + POSITIVE_PROMPT + " --no " + NEGATIVE_PROMPT;
        const imagineBody = { prompt, account_hash: ACCOUNT_HASH };

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
          return resolve({
            statusCode: 500,
            body: JSON.stringify({ error: "UserAPI.ai did not return a hash: " + JSON.stringify(imagineData) })
          });
        }

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

          if (statusData.status === "done") {
            resultUrl = statusData.result.url;
            break;
          }
          if (statusData.status === "error" || statusData.status === "failed") {
            return resolve({
              statusCode: 500,
              body: JSON.stringify({ error: "Image generation failed: " + (statusData.status_reason || statusData.status) })
            });
          }
          attempts++;
        }

        if (!resultUrl) {
          console.log("Timed out waiting for image generation");
          return resolve({
            statusCode: 500,
            body: JSON.stringify({ error: "Timed out waiting for image generation." })
          });
        }

        console.log("Returning result image:", resultUrl);
        resolve({
          statusCode: 200,
          body: JSON.stringify({ image: resultUrl })
        });

      } catch (err) {
        console.log("Exception:", err.message);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: err.message })
        });
      }
    });
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8"));
  });
};
