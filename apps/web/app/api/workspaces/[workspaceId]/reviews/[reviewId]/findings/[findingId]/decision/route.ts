import { forwardReviewJson, workspaceReviewPath } from '@/lib/review-proxy';

type Context = { readonly params: Promise<{ workspaceId: string; reviewId: string; findingId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { workspaceId, reviewId, findingId } = await context.params;
  return forwardReviewJson(request, workspaceReviewPath(workspaceId, reviewId, 'findings', findingId, 'decision'), 'POST');
}
