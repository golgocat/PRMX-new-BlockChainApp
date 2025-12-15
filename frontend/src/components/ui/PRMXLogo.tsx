interface PRMXLogoProps {
  className?: string
}

export function PRMXLogo({ className = 'w-8 h-8' }: PRMXLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Main gradient from cyan to purple */}
        <linearGradient id="mainGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00E5FF" />
          <stop offset="35%" stopColor="#00D4FF" />
          <stop offset="50%" stopColor="#7B5CFA" />
          <stop offset="75%" stopColor="#B44AFF" />
          <stop offset="100%" stopColor="#E040FB" />
        </linearGradient>
        
        {/* Overlay gradients for 3D ribbon effect */}
        <linearGradient id="overlay1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00D4FF" stopOpacity="0.3" />
        </linearGradient>
        
        <linearGradient id="overlay2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#B44AFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#7B5CFA" stopOpacity="0.2" />
        </linearGradient>
        
        <linearGradient id="overlay3" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#E040FB" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#B44AFF" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* Outer rounded hexagon */}
      <path
        d="M50 4
           L88 24
           Q94 28 94 35
           L94 65
           Q94 72 88 76
           L50 96
           Q44 100 38 96
           L12 76
           Q6 72 6 65
           L6 35
           Q6 28 12 24
           L38 8
           Q44 4 50 4
           Z"
        fill="url(#mainGrad)"
      />
      
      {/* Ribbon overlay segments for 3D effect */}
      <path
        d="M50 4
           L88 24
           Q94 28 94 35
           L94 50
           L50 50
           L6 35
           Q6 28 12 24
           L38 8
           Q44 4 50 4
           Z"
        fill="url(#overlay1)"
        opacity="0.6"
      />
      
      <path
        d="M94 50
           L94 65
           Q94 72 88 76
           L50 96
           L50 50
           Z"
        fill="url(#overlay2)"
        opacity="0.5"
      />
      
      <path
        d="M50 96
           Q44 100 38 96
           L12 76
           Q6 72 6 65
           L6 50
           L50 50
           Z"
        fill="url(#overlay3)"
        opacity="0.4"
      />

      {/* White inner hexagon cutout */}
      <path
        d="M50 30
           L68 41
           L68 59
           L50 70
           L32 59
           L32 41
           Z"
        fill="white"
      />
    </svg>
  )
}
