import { forwardReviewJson, workspaceReviewPath } from '@/lib/review-proxy';

type Context = { readonly params: Promise<{ workspaceId: string; reviewId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { workspaceId, reviewId } = await context.params;
  return forwardReviewJson(request, workspaceReviewPath(workspaceId, reviewId), 'GET');
}
