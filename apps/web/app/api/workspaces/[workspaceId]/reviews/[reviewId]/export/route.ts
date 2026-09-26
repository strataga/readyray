import { forwardReviewExport, workspaceReviewPath } from '@/lib/review-proxy';

type Context = { readonly params: Promise<{ workspaceId: string; reviewId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { workspaceId, reviewId } = await context.params;
  const format = new URL(request.url).searchParams.get('format') ?? 'json';
  return forwardReviewExport(request, `${workspaceReviewPath(workspaceId, reviewId, 'export')}?format=${encodeURIComponent(format)}`);
}
