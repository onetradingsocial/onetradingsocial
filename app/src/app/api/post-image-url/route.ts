import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signPostImageUpload, postImagePublicUrl } from '@/lib/storage'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'

const UPLOAD_MAX = 30
const UPLOAD_WINDOW = 60_000

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId'); const idx = Number(searchParams.get('idx')); const ct = searchParams.get('ct')
  if (!postId || !Number.isInteger(idx) || idx < 0 || idx > 3 || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rl = rateLimit(clientKey(request, user.id), UPLOAD_MAX, UPLOAD_WINDOW)
  if (!rl.ok) return tooMany(rl.retryAfter)
  const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).single()
  if (!post || post.author_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const signed = await signPostImageUpload(user.id, postId, idx, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: postImagePublicUrl(user.id, postId, idx, ct) })
}
