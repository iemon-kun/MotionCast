import { useCallback, useEffect, useRef, useState } from 'react'

type StartOptions = {
  width?: number
  height?: number
  fps?: number
}

export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(false)

  const stop = useCallback(() => {
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      setStream(null)
    }
    setActive(false)
  }, [stream])

  const start = useCallback(
    async (opts: StartOptions = { width: 1280, height: 720, fps: 30 }) => {
      try {
        setError(null)
        // 既存ストリームがあれば停止
        if (stream) {
          for (const track of stream.getTracks()) track.stop()
        }
        const constraints: MediaStreamConstraints = {
          video: {
            width: opts.width,
            height: opts.height,
            frameRate: opts.fps,
          },
          audio: false,
        }
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        setStream(s)
        setActive(true)
        const el = videoRef.current
        if (el) {
          el.srcObject = s
          await el.play().catch(() => {})
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '不明なエラー'
        setError(`カメラにアクセスできません: ${msg}`)
        setActive(false)
      }
    },
    [stream],
  )

  useEffect(() => {
    return () => stop()
  }, [stop])

  return (
    <section aria-label="カメラプレビュー" className="camera-section">
      <div className="camera-toolbar">
        {active ? (
          <button className="btn" onClick={() => stop()} aria-pressed={active}>
            カメラ停止
          </button>
        ) : (
          <button className="btn primary" onClick={() => start()}>
            カメラ開始（1280x720/30fps）
          </button>
        )}
      </div>
      {error && <p className="camera-error" role="alert">{error}</p>}
      <div className="camera-preview">
        <video ref={videoRef} muted playsInline className="camera-video" />
      </div>
    </section>
  )
}

export default CameraPreview

