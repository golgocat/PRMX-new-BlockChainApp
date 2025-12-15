'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

interface FadeInProps {
  children: ReactNode
  delay?: number
  className?: string
}

export function FadeIn({ children, delay = 0, className = '' }: FadeInProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const domRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (!hasMounted) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
          }
        })
      },
      { threshold: 0.1 }
    )

    const currentElement = domRef.current
    if (currentElement) observer.observe(currentElement)

    return () => {
      if (currentElement) observer.unobserve(currentElement)
    }
  }, [hasMounted])

  // Server-side and initial client render: show content without animation
  // After mount: apply animation classes
  const animationClasses = hasMounted
    ? isVisible
      ? 'opacity-100 translate-y-0'
      : 'opacity-0 translate-y-12'
    : 'opacity-0 translate-y-12'

  return (
    <div
      ref={domRef}
      className={`transition-all duration-1000 ease-out transform ${animationClasses} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

