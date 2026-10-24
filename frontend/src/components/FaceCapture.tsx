import { useEffect, useRef, useState } from 'react'
import { Button, ErrorText } from './ui.tsx'

export type LivenessAction = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT'

const INSTRUCTIONS: Record<LivenessAction | 'LOOK', string> = {
  LOOK: 'Look straight at the camera',
  BLINK: 'Blink slowly',
  TURN_LEFT: 'Turn your head to your left, then back',
  TURN_RIGHT: 'Turn your head to your right, then back',
}

// The server needs a frontal, eyes-open baseline before each action, and accepts at most 30
// frames: 1 s baseline + 2 × 2.4 s actions at 5 fps = 29 frames.
const FRAME_INTERVAL_MS = 200
const BASELINE_MS = 1000
const ACTION_MS = 2400
const FRAME_WIDTH = 480

type Props = {
  actions: LivenessAction[]
  onCapture: (frames: string[]) => void
}

/** Guided webcam capture for the liveness challenge. Frames are JPEG data URLs. */
export default function FaceCapture({ actions, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState(() =>
    navigator.mediaDevices ? '' : 'This browser cannot access a camera (HTTPS is required).',
  )
  const [instruction, setInstruction] = useState<string | null>(null)

  useEffect(() => {
    let active: MediaStream | null = null
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
      .then((s) => {
        active = s
        setStream(s)
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() =>
        setError('Camera access is needed. Allow camera access in your browser and reload.'),
      )
    return () => active?.getTracks().forEach((track) => track.stop())
  }, [])

  async function start() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = FRAME_WIDTH
    canvas.height = Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth) || 360
    const ctx = canvas.getContext('2d')!
    const frames: string[] = []

    const steps: { label: string; ms: number }[] = [
      { label: INSTRUCTIONS.LOOK, ms: BASELINE_MS },
      ...actions.map((a) => ({ label: INSTRUCTIONS[a], ms: ACTION_MS })),
    ]
    for (const step of steps) {
      setInstruction(step.label)
      const end = Date.now() + step.ms
      while (Date.now() < end) {
        // Raw, un-mirrored frame: the server's left/right logic assumes the camera's view.
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        frames.push(canvas.toDataURL('image/jpeg', 0.8))
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS))
      }
    }
    setInstruction(null)
    onCapture(frames)
  }

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-lg bg-gray-900">
        {/* Mirrored preview only — feels natural, like a mirror. Captured frames are not mirrored. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
          aria-label="Camera preview"
        />
        {instruction && (
          <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-3 text-center text-lg font-semibold text-white">
            {instruction}
          </p>
        )}
      </div>
      <p aria-live="assertive" className="sr-only">
        {instruction}
      </p>
      <ErrorText>{error}</ErrorText>
      {!instruction && !error && (
        <Button type="button" onClick={() => void start()} disabled={!stream} className="w-full">
          Start face check
        </Button>
      )}
    </div>
  )
}
