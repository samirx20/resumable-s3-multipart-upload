import { NextResponse } from "next/server";
import { MultipartUploadError } from "../../../../../../src";
import { createUploadService } from "../../../../lib/upload-service";

async function getCurrentUserId(request: Request) {
  // Replace this with your real auth lookup.
  // Examples:
  // - Supabase SSR: const { data: { user } } = await supabase.auth.getUser()
  // - NextAuth: const session = await auth()
  // - Custom auth: verify a signed cookie/JWT
  return request.headers.get("x-user-id");
}

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = await request.json();
    const service = createUploadService();

    if (body.action === "create") {
      const result = await service.create({
        userId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        fileLastModified: body.fileLastModified,
        chunkSizeBytes: body.chunkSizeBytes,
        totalParts: body.totalParts,
        metadata: body.metadata,
      });

      return NextResponse.json(result);
    }

    if (body.action === "status") {
      const result = await service.status(body.sessionId, userId);
      return NextResponse.json(result);
    }

    if (body.action === "signPart") {
      const signedUrl = await service.signPart({
        userId,
        sessionId: body.sessionId,
        partNumber: body.partNumber,
      });

      return NextResponse.json({ signedUrl });
    }

    if (body.action === "complete") {
      const result = await service.complete({
        userId,
        sessionId: body.sessionId,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    if (error instanceof MultipartUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Multipart upload route failed:", error);
    return NextResponse.json({ error: "Multipart upload failed." }, { status: 500 });
  }
}
