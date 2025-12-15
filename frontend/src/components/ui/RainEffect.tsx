'use client'

import { useEffect, useState } from 'react'

interface RainDrop {
  id: number
  left: number
  delay: number
  duration: number
  opacity: number
  size: number
}

export function RainEffect() {
  const [drops, setDrops] = useState<RainDrop[]>([])

  useEffect(() => {
    // Generate rain drops on client side only
    const generatedDrops: RainDrop[] = []
    const dropCount = 100

    for (let i = 0; i < dropCount; i++) {
      generatedDrops.push({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 5,
        duration: 0.5 + Math.random() * 0.5,
        opacity: 0.1 + Math.random() * 0.3,
        size: 10 + Math.random() * 20,
      })
    }

    setDrops(generatedDrops)
  }, [])

  if (drops.length === 0) return null

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Rain drops */}
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="absolute w-px bg-gradient-to-b from-transparent via-white to-transparent animate-rain"
          style={{
            left: `${drop.left}%`,
            height: `${drop.size}px`,
            opacity: drop.opacity,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration}s`,
          }}
        />
      ))}

      {/* Splash effects at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 overflow-hidden">
        {drops.slice(0, 30).map((drop) => (
          <div
            key={`splash-${drop.id}`}
            className="absolute bottom-0 animate-splash"
            style={{
              left: `${drop.left}%`,
              animationDelay: `${drop.delay + drop.duration}s`,
              animationDuration: '0.6s',
            }}
          >
            <div className="w-1 h-1 rounded-full bg-white/20" />
          </div>
        ))}
      </div>

      {/* Ambient mist/fog at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-brand-teal/5 via-transparent to-transparent" />
    </div>
  )
}
