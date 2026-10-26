import Script from "next/script";
import { shell } from "../lib/shell";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
export const dynamic="force-dynamic";
export default async function Home(){ await getChatGPTUser(); const html=shell.replace("/signin-with-chatgpt?return_to=%2F",chatGPTSignInPath("/")).replace("/signout-with-chatgpt?return_to=%2F",chatGPTSignOutPath("/")); return <><div dangerouslySetInnerHTML={{__html:html}}/><Script src="/app.js" strategy="afterInteractive"/></>; }
