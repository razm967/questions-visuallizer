"use client"; // Required for using React hooks

import { useState, ChangeEvent, FormEvent, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input"; // For file input
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; // For error messages
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"; // Added Card components
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"; // For "Coming Soon" button
import { Terminal, Expand, DownloadCloud, XCircle, Loader2 } from "lucide-react"; // Icon for Alert and new icons, Loader2 for button spinner

export default function HomePage() {
  const [problemText, setProblemText] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [ocrText, setOcrText] = useState<string>(""); // To store text from OCR
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(false); // New state for OCR loading
  const [isVisualizing, setIsVisualizing] = useState<boolean>(false); // Renamed from isLoading for clarity
  const [error, setError] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null); 
  const imageRef = useRef<HTMLImageElement>(null); // Ref for the image element for fullscreen
  const [isInFullScreen, setIsInFullScreen] = useState<boolean>(false); // State for fullscreen status

  // Effect to listen to fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsInFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange); // Safari
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);    // Firefox
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);     // IE/Edge

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const clearVisualizationState = () => {
    setImageBase64(null);
    setError(null); // Also clear errors when input changes significantly
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setProblemText(event.target.value);
    if (selectedImage) setSelectedImage(null);
    if (ocrText) setOcrText(""); 
    clearVisualizationState();
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedImage(file);
      setProblemText(""); 
      setOcrText(""); 
      clearVisualizationState();
      // Clear other states

      setIsOcrLoading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        // formData.append('language', 'por'); // Example: if you want to specify a language

        const response = await fetch('/api/ocr', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `OCR request failed with status ${response.status}. Details: ${result.details}`);
        }

        setOcrText(result.extractedText || "No text found in image. Please review or try a different image.");

      } catch (ocrError: any) {
        console.error("OCR Error:", ocrError);
        setError(`OCR failed: ${ocrError.message || 'Unknown error'}`);
        setOcrText("OCR processing failed. You can try typing the problem manually."); // Provide feedback in OCR box
      } finally {
        setIsOcrLoading(false);
      }
    }
  };
  
  // This will be the text box for users to edit OCR results
  const handleOcrTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setOcrText(event.target.value);
    clearVisualizationState(); 
  };

  const handleSubmit = async (event: FormEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsVisualizing(true);
    clearVisualizationState();

    const textToProcess = selectedImage ? ocrText : problemText;

    if (!textToProcess.trim() && !selectedImage) {
      setError("Please enter a math problem or upload an image.");
      setIsVisualizing(false);
      return;
    }
    
    if (selectedImage && !ocrText.trim()) {
        setError("Please wait for OCR to complete, or if it failed, ensure the image has text or type manually.");
        setIsVisualizing(false);
        return;
    }
    if (selectedImage && ocrText === "OCR processing failed. You can try typing the problem manually."){
        setError("OCR processing failed. Please review the image or type the problem manually.");
        setIsVisualizing(false);
        return;
    }

    console.log("Submitting to /api/visualize:", textToProcess);

    try {
      const response = await fetch('/api/visualize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ problemText: textToProcess }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Try to parse details if they exist, otherwise use a generic message
        const errorDetails = result.details ? (typeof result.details === 'string' ? result.details : JSON.stringify(result.details)) : 'Unknown error from API';
        throw new Error(result.error || `Visualization API request failed. Details: ${errorDetails}`);
      }
      
      if (result.imageBase64) {
        setImageBase64(result.imageBase64);
      } else {
        // This handles cases where the API might not return an imageBase64 string as expected,
        setError(result.error || result.warning || "No image data returned by the visualizer.");
        console.warn("API returned OK but no imageBase64:", result);
      }

    } catch (submissionError: any) {
      console.error("Visualization Submission Error:", submissionError);
      setError(`Visualization failed: ${submissionError.message}`);
      setImageBase64(null); 
    } finally {
      setIsVisualizing(false);
    }
  };

  const handleDownloadImage = () => {
    if (!imageBase64) return;
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${imageBase64}`;
    link.download = 'visualization.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleToggleFullScreen = () => {
    if (!imageRef.current) return;
    if (!document.fullscreenElement) { // If not in fullscreen, request it
      if (imageRef.current.requestFullscreen) {
        imageRef.current.requestFullscreen();
      } else if ((imageRef.current as any).mozRequestFullScreen) { 
        (imageRef.current as any).mozRequestFullScreen();
      } else if ((imageRef.current as any).webkitRequestFullscreen) { 
        (imageRef.current as any).webkitRequestFullscreen();
      } else if ((imageRef.current as any).msRequestFullscreen) { 
        (imageRef.current as any).msRequestFullscreen();
      }
    } else { // If in fullscreen, exit
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  };

  const isLoading = isOcrLoading || isVisualizing;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="w-full max-w-2xl space-y-8">
        <header className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">
            Math Problem Visualizer
          </h1>
          <p className="text-lg text-slate-300">
            Transform your math problems from text or images into clear visualizations.
          </p>
        </header>

        <Card className="bg-slate-800/70 border-slate-700 shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl text-slate-100">Input Your Problem</CardTitle>
            <CardDescription className="text-slate-400">Type, paste, or upload an image of your math problem.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label htmlFor="problemText" className="block text-sm font-medium text-slate-300 mb-1.5">
                Type or paste problem:
              </label>
              <Textarea
                id="problemText"
                placeholder="e.g., A triangle ABC has angle A = 90 degrees, side AB = 3cm, side AC = 4cm. Find side BC."
                className="min-h-[100px] bg-slate-700/80 border-slate-600 text-white focus:ring-pink-500 focus:border-pink-500 placeholder:text-slate-500"
                rows={4}
                value={problemText}
                onChange={handleTextChange}
                disabled={isLoading || !!selectedImage}
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-700" /></div>
              <div className="relative flex justify-center text-sm"><span className="bg-slate-800/70 px-2 text-slate-400 rounded-full">OR</span></div>
            </div>

            <div>
              <label htmlFor="imageUpload" className="block text-sm font-medium text-slate-300 mb-1.5">
                Upload an image:
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-grow">
                  <Button
                    variant="outline"
                    className="w-full border-sky-500 text-sky-300 hover:bg-sky-500/20 hover:text-sky-200 hover:border-sky-400 flex items-center justify-center gap-2"
                    onClick={() => document.getElementById('imageUpload')?.click()}
                    disabled={isLoading}
                    type="button"
                  >
                    <DownloadCloud size={18} />
                    Choose File
                  </Button>
                  <Input
                    id="imageUpload"
                    type="file"
                    className="hidden"
                    accept="image/png, image/jpeg, image/webp"
                    onChange={handleImageChange}
                    disabled={isLoading}
                  />
                  {selectedImage && (
                    <p className="text-xs text-slate-400 mt-1.5 truncate" title={selectedImage.name}>
                      Selected: {selectedImage.name}
                    </p>
                  )}
                </div>

                <div className="flex-grow">
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="inline-block w-full cursor-not-allowed">
                          <Button
                            variant="outline"
                            className="w-full border-purple-500 text-purple-300"
                            disabled
                            style={{ pointerEvents: 'none' }}
                            type="button"
                          >
                            Take Picture (Coming Soon)
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="bg-slate-900 text-slate-200 border-slate-700">
                        <p>This feature will be available in a future update!</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>
            
            {selectedImage && (
              <div className="pt-4 border-t border-slate-700/50">
                <label htmlFor="ocrTextReview" className="block text-sm font-medium text-slate-300 mb-1.5">
                  {isOcrLoading ? "Recognizing text..." : "Review recognized text:"}
                </label>
                <Textarea
                  id="ocrTextReview"
                  className="min-h-[100px] bg-slate-700/80 border-slate-600 text-white focus:ring-amber-500 focus:border-amber-500 placeholder:text-slate-500 disabled:opacity-80"
                  rows={4}
                  value={isOcrLoading ? "Processing image... please wait." : ocrText}
                  onChange={handleOcrTextChange}
                  disabled={isLoading}
                  placeholder={isOcrLoading ? "" : "Text from image will appear here..."}
                />
                {!isOcrLoading && <p className="text-xs text-slate-400 mt-1">Correct any errors in the text from the image.</p>}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 hover:from-purple-700 hover:via-pink-700 hover:to-red-700 text-white font-semibold py-3 text-base disabled:opacity-70 flex items-center justify-center" // Added flex items-center justify-center for icon alignment
              onClick={handleSubmit}
              disabled={isLoading || (!problemText.trim() && !selectedImage && !ocrText.trim())} // Adjusted disabled condition for submit
            >
              {isVisualizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (isOcrLoading ? "Processing OCR..." : "Visualize Problem")}
            </Button>
          </CardFooter>
        </Card>

        {error && (
          <Alert variant="destructive" className="bg-red-900/40 border-red-700/60 text-red-300 mt-6 shadow-lg">
            <Terminal className="h-4 w-4" color="#fca5a5"/>
            <AlertTitle className="text-red-200">Error Occurred</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {imageBase64 && !error && (
          <Card className="mt-8 bg-slate-800/70 border-slate-700 shadow-xl">
            <CardHeader>
              <CardTitle className="text-2xl text-slate-100">Generated Visualization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative group aspect-video bg-slate-700/50 rounded-lg flex items-center justify-center border border-slate-600 overflow-hidden mb-4">
                <img 
                  ref={imageRef}
                  src={`data:image/png;base64,${imageBase64}`} 
                  alt="Generated Math Visualization" 
                  className="max-w-full max-h-full object-contain cursor-pointer transition-transform duration-150 ease-in-out group-hover:scale-105"
                  onClick={handleToggleFullScreen} 
                />
                {/* Overlay Exit Fullscreen button - only visible when this image is fullscreen via JS check */} 
                {isInFullScreen && document.fullscreenElement === imageRef.current && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 z-50 bg-black/50 hover:bg-black/75 text-white hover:text-white"
                    onClick={handleToggleFullScreen} // Same toggle function works for exit
                    title="Exit Full Screen"
                  >
                    <XCircle size={24} />
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-400 text-center">Image generated based on the problem description. Click image to toggle full screen.</p>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={handleDownloadImage}
                variant="outline"
                className="w-full sm:w-auto border-green-500 text-green-300 hover:bg-green-500/20 hover:text-green-200 hover:border-green-400 flex items-center gap-2"
              >
                <DownloadCloud size={18} /> Download PNG
              </Button>
              <Button 
                onClick={handleToggleFullScreen} 
                variant="outline"
                className="w-full sm:w-auto border-sky-500 text-sky-300 hover:bg-sky-500/20 hover:text-sky-200 hover:border-sky-400 flex items-center gap-2"
              >
                <Expand size={18} /> 
                {isInFullScreen && document.fullscreenElement === imageRef.current ? 'Exit Full Screen' : 'Full Screen'}
              </Button>
            </CardFooter>
          </Card>
        )}
        
        {isVisualizing && !imageBase64 && !error && (
          <Card className="mt-8 bg-slate-800/70 border-slate-700 shadow-xl">
            <CardContent className="pt-6 text-center">
              <div className="flex justify-center items-center mb-3">
                  <svg className="animate-spin h-10 w-10 text-pink-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
              </div>
              <p className="text-slate-300 text-lg font-medium">Generating Visualization...</p>
              <p className="text-slate-400 text-sm">Please wait a moment.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
