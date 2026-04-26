import { SlideContainer } from './shared/SlideContainer'
import { MouseParallax } from './shared/MouseParallax'
import './shared/slideStyles.css'
import './shared/DiagramStyles.css'
import './App.css'
import { HookSlide } from './slides/HookSlide'
import { GameplaySlide } from './slides/GameplaySlide'
import { AISlide } from './slides/AISlide'
import { QRSlide } from './slides/QRSlide'

export default function App() {
  return (
    <MouseParallax>
      <SlideContainer>
        <HookSlide />
        <GameplaySlide />
        <AISlide />
        <QRSlide />
      </SlideContainer>
    </MouseParallax>
  )
}
