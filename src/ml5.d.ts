// ml5.js ships without TypeScript types; only the object detector is used here.
declare module 'ml5' {
  export interface Ml5Detection {
    label: string
    confidence: number
    x: number
    y: number
    width: number
    height: number
    normalized: { x: number; y: number; width: number; height: number }
  }
  export interface Ml5ObjectDetector {
    ready: Promise<unknown>
    detect(input: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement): Promise<Ml5Detection[]>
  }
  const ml5: {
    objectDetection(model: 'cocossd', options?: Record<string, unknown>): Ml5ObjectDetector
    version?: string
  }
  export default ml5
}
