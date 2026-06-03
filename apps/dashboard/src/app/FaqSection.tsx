'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FAQS } from '@/app/constants';

export default function FaqSection() {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  return (
    <section id="faq" className="w-full py-12 sm:py-16 scroll-mt-24 flex flex-col items-center">
      <div className="text-center max-w-lg mb-8 sm:mb-10 px-2">
        <h2 className="text-xl sm:text-2xl md:text-4xl font-bold tracking-tight text-white font-display">
          Foire Aux Questions
        </h2>
        <p className="mt-2 text-xs sm:text-sm text-white/50 leading-relaxed font-sans">
          Tout ce que vous devez savoir pour déployer Sokar dans votre établissement.
        </p>
      </div>

      <div className="w-full max-w-3xl flex flex-col gap-3 sm:gap-4 mt-4 sm:mt-6 px-2 sm:px-0">
        {FAQS.map((faq, idx) => (
          <div
            key={idx}
            className="glass-card rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-white/10"
          >
            <button
              onClick={() => toggleFaq(idx)}
              className="w-full px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between text-left focus:outline-none transition-colors duration-200 hover:bg-white/[0.02] min-h-[56px]"
            >
              <span className="text-sm sm:text-base font-semibold text-white font-sans pr-4">
                {faq.question}
              </span>
              <ChevronDown
                size={16}
                className={`text-white/40 transition-transform duration-300 flex-shrink-0 ${
                  openFaqIndex === idx ? 'rotate-180 text-cyan-400' : 'rotate-0'
                }`}
              />
            </button>

            <div
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                openFaqIndex === idx ? 'max-h-[320px] sm:max-h-[260px] border-t border-white/5 overflow-y-auto' : 'max-h-0'
              }`}
            >
              <p className="px-5 sm:px-6 py-4 sm:py-5 text-sm sm:text-sm text-white/50 leading-relaxed font-sans bg-white/[0.01]">
                {faq.answer}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
