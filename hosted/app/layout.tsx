import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Axiom · Research Desk",description:"Private evidence-led paper investment research workspace.",icons:{icon:"/icon.svg"},manifest:"/manifest.webmanifest"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
