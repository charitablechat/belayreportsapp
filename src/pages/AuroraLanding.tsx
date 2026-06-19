import { motion } from "framer-motion";
import { SEO } from "@/components/SEO";
import { GradientButton } from "@/components/ui/gradient-button";
import { useNavigate } from "react-router-dom";
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;
import acctLogo from "@/assets/acct-accredited-vendor.png";
import authVideo from "@/assets/auth-background.mp4";

export default function AuroraLanding() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen">
      <SEO
        title="Welcome to Belay Reports — Rope Course Inspections"
        description="Professional rope course and aerial adventure inspections powered by an offline-first digital reporting platform built by working inspectors."
        path="/welcome"
      />
      <div className="absolute inset-0 z-0">
        <video
          src={authVideo}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      </div>
      <div className="relative z-10 min-h-screen bg-background/80 backdrop-blur-sm flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0.0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.3,
            duration: 0.8,
            ease: "easeInOut",
          }}
          className="relative flex flex-col gap-6 items-center justify-center px-2 md:px-4"
        >
          <div className="flex items-center gap-4 mb-4">
            <img src={belayReportsLogo} alt="Belay Reports" className="h-16 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
            <img src={acctLogo} alt="ACCT Accredited Vendor" className="h-16 w-auto object-contain" />
          </div>
          
          <h1 className="text-4xl md:text-7xl font-bold text-primary dark:text-white text-center">
            Professional Rope Course Inspections
          </h1>
          
          <div className="font-light text-lg md:text-2xl text-muted-foreground dark:text-neutral-200 py-4 text-center max-w-2xl">
            Comprehensive inspection reports for rope courses, zip lines, and aerial adventure equipment
          </div>
          
          <div className="flex gap-4">
            <GradientButton 
              className="min-w-[140px] px-10 py-5 text-lg" 
              onClick={() => navigate('/dashboard')}
            >
              Get Started
            </GradientButton>
            <GradientButton 
              variant="variant"
              className="min-w-[140px] px-10 py-5 text-lg" 
              onClick={() => navigate('/capabilities')}
            >
              Learn More
            </GradientButton>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
