import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn } from 'child_process'; // Added for Python execution
import { Buffer } from 'buffer'; // For base64 to Buffer conversion
import { v4 as uuidv4 } from 'uuid'; // For generating unique filenames
import { supabase } from '../../../lib/supabaseClient'; // Re-import Supabase client

// Use Gemini 2.0 Flash - newer model with better performance
const MODEL_NAME = "gemini-2.0-flash";

const ENGINEERED_PROMPT_TEMPLATE = `
You are an expert Python programmer specializing in mathematical visualizations.
Your task is to take a math problem description and generate Python code to visualize it.

The visualization should be clear, mathematically accurate, and aesthetically pleasing.

Key requirements for the visualization:
- When relevant to the problem, include text annotations directly on the image. These annotations should display:
    - Lengths of givensides (e.g., '3cm', 'x units').
    - given areas (e.g., 'Area = 35 cm²').
    - Measures of angles (e.g., '30°', 'θ').
    - Coordinates of important points only if they are part of the problem.
- Use Matplotlib's \`plt.text()\` or an Axes object's \`ax.text()\` / \`ax.annotate()\` methods for these text annotations.
- Ensure all annotations are legible, clearly positioned (e.g., near the feature they describe but not overlapping other important elements or each other), with minimal text and appropriately sized for clarity.
- The numerical values, variables, and units in these annotations must precisely match the problem statement.
- Represent geometric figures accurately according to the problem's specifications (e.g., right angles should appear as 90 degrees, relative lengths should be visually proportional if specific values are given, etc.).

Use the Matplotlib library for plotting both analytic geometry problems (lines, functions, points on a coordinate plane) and general geometric shapes (triangles, circles, polygons, angles).
Ensure all geometric constructions and renderings are done directly with Matplotlib.

Output ONLY the Python code required to generate the visualization. Do not include any explanatory text, markdown formatting, or anything other than the Python code itself.

Important: The Matplotlib plot should be converted to a base64 encoded string directly in the Python code and printed to standard output. 
Specifically, after creating the plot with plt.figure() (or plt.subplots()), use the following snippet to get the base64 string:

import io
import base64

pic_iobytes = io.BytesIO()
plt.savefig(pic_iobytes, format='png')
pic_iobytes.seek(0)
pic_hash = base64.b64encode(pic_iobytes.read())
print(f"MATPLOTLIB_BASE64_START:{pic_hash.decode('utf-8')}:MATPLOTLIB_BASE64_END")
plt.close() # Close the plot to free up memory

Ensure no other print statements are present in the Python code output, only the base64 string in the format specified above.
Do not save to a file like 'visualization.png'.

Here is the math problem:
--- START PROBLEM ---
{PROBLEM_TEXT}
--- END PROBLEM ---

Python code (printing base64 string of the plot):
`;

// Helper function to execute Python code and capture output
function executePython(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // It's generally safer to write the code to a temporary file
    // and execute that file, but for simplicity with -c:
    // Make sure the 'code' doesn't contain anything that would break the command line.
    // For complex scripts, writing to a temp file is more robust.
    const pythonProcess = spawn('python', ['-c', code]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (exitCode) => {
      console.log(`Python process exited with code ${exitCode}`);
      if (exitCode === 0) {
        if (stderr) {
          // Sometimes Matplotlib might output warnings to stderr even on success
          console.warn('Python process stderr (but exited 0):', stderr);
        }
        resolve(stdout);
      } else {
        console.error('Python process stderr:', stderr);
        reject(new Error(`Python script execution failed with code ${exitCode}: ${stderr}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}

export async function POST(request: NextRequest) {
  console.log('\n=== START /api/visualize POST REQUEST ===');
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ ERROR: GEMINI_API_KEY not set in environment variables');
    return NextResponse.json({ 
      error: 'AI service configuration error - API key not found',
      details: 'Please set the GEMINI_API_KEY environment variable'
    }, { status: 500 });
  }
  console.log('✓ API key found');

  try {
    let body;
    try {
      const rawBody = await request.text();
      console.log('📝 Raw request body:', rawBody);
      body = JSON.parse(rawBody);
    } catch (e: any) {
      console.error('❌ Failed to parse request body:', e);
      return NextResponse.json({ error: 'Invalid JSON in request body', details: e.message }, { status: 400 });
    }

    const problemText = body.problemText as string;
    console.log('📊 Problem text:', problemText);

    if (!problemText || typeof problemText !== 'string' || problemText.trim() === '') {
      console.error('❌ Invalid or empty problem text');
      return NextResponse.json({ error: 'No problem text provided or text is invalid.' }, { status: 400 });
    }

    console.log('🔄 Initializing Gemini API...');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.3, // Slightly lower for more deterministic base64 output structure
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      }
    });

    const fullPrompt = ENGINEERED_PROMPT_TEMPLATE.replace('{PROBLEM_TEXT}', problemText);
    console.log('📤 Sending request to Gemini API...');
    
    try {
      const result = await model.generateContent(fullPrompt);
      console.log('📥 Received response from Gemini API');
      
      const response = result.response;
      if (!response) {
        console.error('❌ No response from Gemini API');
        return NextResponse.json({ error: 'AI model returned an empty response' }, { status: 500 });
      }

      if (response.promptFeedback?.blockReason) {
        console.error('❌ Content blocked:', response.promptFeedback);
        return NextResponse.json({
          error: `Content blocked: ${response.promptFeedback.blockReason}`,
          details: response.promptFeedback
        }, { status: 400 });
      }

      const generatedCode = response.text();
      if (!generatedCode || generatedCode.trim() === '') {
        console.error('❌ Empty response text from Gemini');
        return NextResponse.json({ error: 'Empty response from AI' }, { status: 500 });
      }

      if (generatedCode.startsWith('ERROR:CANNOT_VISUALIZE:')) {
        console.log('ℹ️ AI cannot visualize this problem:', generatedCode);
        return NextResponse.json({ 
          error: 'Problem cannot be visualized by AI', // Clarified error source
          details: generatedCode 
        }, { status: 422 });
      }

      // Clean the generated code from potential markdown fences
      let cleanedCode = generatedCode.trim();
      if (cleanedCode.startsWith('```python')) {
        cleanedCode = cleanedCode.substring('```python'.length).trimStart();
      }
      if (cleanedCode.endsWith('```')) {
        cleanedCode = cleanedCode.substring(0, cleanedCode.length - '```'.length).trimEnd();
      }
      // Also remove a single leading line if it's just ```python, as seen in logs
      const lines = cleanedCode.split('\n');
      if (lines[0].trim() === 'python') { // A bit more general than just ```python
          console.warn("Warning: AI included 'python' as the first line. Removing it.");
          lines.shift();
          cleanedCode = lines.join('\n');
      } else if (lines[0].trim() === '```python') {
          console.warn("Warning: AI included '```python' as the first line. Removing it.");
          lines.shift();
          cleanedCode = lines.join('\n');
      }
      
      // Ensure there isn't a lingering ``` at the very end if it was missed by the first pass
      if (cleanedCode.endsWith('```')) {
        cleanedCode = cleanedCode.substring(0, cleanedCode.length - '```'.length).trimEnd();
      }

      console.log('🧹 Cleaned Python code (first 100 chars):', cleanedCode.substring(0, 100));

      // Execute the Python code on the server
      console.log('🐍 Executing generated Python code on the server...');
      try {
        const pythonOutput = await executePython(cleanedCode); // Use cleanedCode
        console.log('📄 Python script output received.');

        // Extract the base64 string
        const base64MarkerStart = 'MATPLOTLIB_BASE64_START:';
        const base64MarkerEnd = ':MATPLOTLIB_BASE64_END';
        
        const startIndex = pythonOutput.indexOf(base64MarkerStart);
        const endIndex = pythonOutput.indexOf(base64MarkerEnd, startIndex + base64MarkerStart.length);

        if (startIndex !== -1 && endIndex !== -1) {
          const imageBase64 = pythonOutput.substring(startIndex + base64MarkerStart.length, endIndex);
          console.log('🖼️ Successfully extracted base64 image string.');

          // Return only the base64 image
          return NextResponse.json({ imageBase64: imageBase64 }, { status: 200 });

        } else {
          console.error('❌ Failed to extract base64 string from Python output. Output:', pythonOutput);
          return NextResponse.json({ 
            error: 'Failed to process visualization from Python script',
            details: 'Could not find base64 image markers in the script output. Python output was: ' + pythonOutput
          }, { status: 500 });
        }

      } catch (pythonError: any) {
        console.error('❌ Error executing Python code:', pythonError);
        return NextResponse.json({
          error: 'Error executing visualization script',
          details: pythonError.message
        }, { status: 500 });
      }

    } catch (apiError: any) {
      console.error('❌ Gemini API Error:', apiError);
      return NextResponse.json({ 
        error: 'Error calling Gemini API',
        details: apiError.message
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('❌ Unexpected Error in POST route:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message, type: error.constructor.name }, { status: 500 });
  } finally {
    console.log('=== END /api/visualize POST REQUEST ===\n');
  }
} 