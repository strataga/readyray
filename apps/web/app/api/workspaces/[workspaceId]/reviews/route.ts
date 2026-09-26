import { forwardReviewJson, workspaceReviewPath } from '@/lib/review-proxy';

type Context = { readonly params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { workspaceId } = await context.params;
  return forwardReviewJson(request, workspaceReviewPath(workspaceId), 'GET');
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { workspaceId } = await context.params;
  return forwardReviewJson(request, workspaceReviewPath(workspaceId), 'POST');
}
