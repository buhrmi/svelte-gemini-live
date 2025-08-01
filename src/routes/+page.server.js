import { GoogleGenAI } from "@google/genai";
import { GOOGLE_API_KEY } from "$env/static/private";

export async function load() {
  const client = new GoogleGenAI({
    apiKey: GOOGLE_API_KEY
  });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const token = await client.authTokens.create({
    config: {
      uses: 1, // The default
      expireTime: expireTime, // Default is 30 mins
      newSessionExpireTime: new Date(Date.now() + (1 * 60 * 1000)), // Default 1 minute in the future
      httpOptions: {apiVersion: 'v1alpha'},
    },
  });

  return {
    token
  };
}