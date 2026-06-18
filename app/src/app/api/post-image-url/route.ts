import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signPostImageUpload, postImagePublicUrl } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId'); const idx = Number(searchParams.get('idx')); const ct = searchParams.get('ct')
  if (!postId || !Number.isInteger(idx) || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).single()
  if (!post || post.author_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const signed = await signPostImageUpload(user.id, postId, idx, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: postImagePublicUrl(user.id, postId, idx, ct) })
}
