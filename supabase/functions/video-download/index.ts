// supabase/functions/video-download/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import YTDlpWrap from "npm:ytdlp-nodejs@latest";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url, quality = "720", format = "mp4" } = await req.json();
    const deviceId = req.headers.get("x-device-id") || "unknown";
    
    if (!url) throw new Error("URL is required");

    const supabaseAdmin = createClient(
      Deno.env.get("MY_SUPABASE_URL")!,
      Deno.env.get("MY_SERVICE_ROLE_KEY")!
    );

    // Initialize YTDlpWrap - this is the default export class
    const ytDlp = new YTDlpWrap();
    
    // Use getVideoInfo (not getInfoAsync) - this is the correct method name
    const videoInfo = await ytDlp.getVideoInfo(url);
    const title = videoInfo.title || "video";
    const duration = videoInfo.duration?.toString() || "0";

    // Determine format options
    const isAudioOnly = format === "mp3";
    const height = parseInt(quality) || 720;
    
    // Download to temp file
    const outputExt = isAudioOnly ? "mp3" : "mp4";
    const tempFile = `/tmp/download_${Date.now()}.${outputExt}`;

    // Use execPromise with proper arguments (this is the reliable method)
    await ytDlp.execPromise([
      "-f", isAudioOnly ? "bestaudio" : `bestvideo[height<=${height}]+bestaudio/best`,
      "--merge-output-format", outputExt,
      "-o", tempFile,
      "--no-playlist",
      "--no-warnings",
      url
    ]);

    // Read the downloaded file
    const fileData = await Deno.readFile(tempFile);
    
    // Generate safe filename
    const safeTitle = title.replace(/[^a-z0-9]/gi, "_").substring(0, 50);
    const filename = `${safeTitle}_${Date.now()}.${outputExt}`;
    const storagePath = `downloads/${deviceId}/${filename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin
      .storage.from("videos")
      .upload(storagePath, fileData, {
        contentType: isAudioOnly ? "audio/mpeg" : "video/mp4",
        upsert: false,
      });
    
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // Create signed URL (2 hours expiry)
    const { data: signedData, error: signedError } = await supabaseAdmin
      .storage.from("videos")
      .createSignedUrl(storagePath, 7200);
    
    if (signedError) throw new Error(`Signed URL failed: ${signedError.message}`);

    // Save metadata to database
    const { error: dbError } = await supabaseAdmin.from("downloads").insert({
      device_id: deviceId,
      video_url: url,
      title,
      filename,
      storage_path: storagePath,
      quality: isAudioOnly ? "audio" : `${height}p`,
      format: outputExt,
      duration,
      downloaded_at: new Date().toISOString(),
      status: "completed"
    });

    if (dbError) console.error("DB insert error:", dbError);

    // Cleanup temp file
    await Deno.remove(tempFile).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        download_url: signedData.signedUrl,
        filename,
        title,
        expires_in: "2 hours",
        size: fileData.length
      }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" }}
    );

  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }}
    );
  }
});