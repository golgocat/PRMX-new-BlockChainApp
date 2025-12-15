import { LPNavbar } from '@/components/sections/lp/LPNavbar'
import { LPHero } from '@/components/sections/lp/LPHero'
import { LPOpportunity } from '@/components/sections/lp/LPOpportunity'
import { LPMechanics } from '@/components/sections/lp/LPMechanics'
import { LPYieldStrategy } from '@/components/sections/lp/LPYieldStrategy'
import { LPForAgents } from '@/components/sections/lp/LPForAgents'
import { LPLiveData } from '@/components/sections/lp/LPLiveData'
import { LPRiskProfile } from '@/components/sections/lp/LPRiskProfile'
import { LPFAQ } from '@/components/sections/lp/LPFAQ'
import { LPCTA } from '@/components/sections/lp/LPCTA'
import { LPFooter } from '@/components/sections/lp/LPFooter'

export default function LPPage() {
  return (
    <>
      <LPNavbar />
      <main>
        <LPHero />
        <LPOpportunity />
        <LPMechanics />
        <LPYieldStrategy />
        <LPForAgents />
        <LPLiveData />
        <LPRiskProfile />
        <LPFAQ />
        <LPCTA />
      </main>
      <LPFooter />
    </>
  )
}
