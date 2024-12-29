// src/app/api/proxyImage/route.ts

// 部分图片无法加载,所以加了这个proxy
import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
  }

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const headers = new Headers();
    headers.set('Content-Type', response.headers['content-type']);
    return new NextResponse(Buffer.from(response.data, 'binary'), { headers });
  } catch (error) {
    console.error(error); // Log error for debugging
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}