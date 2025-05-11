import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const language = formData.get('language') as string || 'eng'; // Default to English if not specified

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const ocrApiKey = process.env.OCR_SPACE_API_KEY;
    if (!ocrApiKey) {
      console.error('OCR_SPACE_API_KEY not set in environment variables');
      return NextResponse.json({ error: 'OCR service configuration error.' }, { status: 500 });
    }

    const ocrFormData = new FormData();
    ocrFormData.append('file', file);
    ocrFormData.append('apikey', ocrApiKey);
    ocrFormData.append('language', language); // Add language parameter
    ocrFormData.append('isOverlayRequired', 'false'); // We only need the text
    // ocrFormData.append('OCREngine', '2'); // You can experiment with OCR Engine 1 or 2

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: ocrFormData,
    });

    if (!ocrResponse.ok) {
      const errorData = await ocrResponse.json().catch(() => ({})); // Try to parse error, default to empty obj
      console.error('OCR.space API Error:', errorData);
      return NextResponse.json(
        { 
          error: `OCR API request failed with status ${ocrResponse.status}.`, 
          details: errorData?.ErrorMessage || errorData?.ErrorDetails || 'Unknown OCR API error' 
        },
        { status: ocrResponse.status }
      );
    }

    const ocrData = await ocrResponse.json();

    if (ocrData.IsErroredOnProcessing) {
      console.error('OCR.space processing error:', ocrData.ErrorMessage);
      return NextResponse.json(
        { error: 'OCR processing failed.', details: ocrData.ErrorMessage?.join(', ') || 'See OCR API logs for details.' }, 
        { status: 500 }
      );
    }

    if (!ocrData.ParsedResults || ocrData.ParsedResults.length === 0) {
      return NextResponse.json({ extractedText: 'No text found in image.', ocrData }, { status: 200 });
    }

    const extractedText = ocrData.ParsedResults[0].ParsedText;
    
    return NextResponse.json({ extractedText });

  } catch (error: any) {
    console.error('Error in /api/ocr:', error);
    return NextResponse.json({ error: 'Internal server error.', details: error.message }, { status: 500 });
  }
} 