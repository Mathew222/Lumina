<p align="center">
  <img src="https://raw.githubusercontent.com/Mathew222/Lumina/master/public/logo.png" width="100" alt="Lumina Logo" />
</p>

<h1 align="center">Lumina</h1>

<p align="center">
  <strong>Real-time AI-powered subtitle generation for your desktop.</strong><br />
  Built with React, Electron, and Speech-to-Text Engines.
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/Mathew222/Lumina?style=flat-square&color=5D6AD1" alt="License" />
  <img src="https://img.shields.io/github/stars/Mathew222/Lumina?style=flat-square&color=5D6AD1" alt="Stars" />
  <img src="https://img.shields.io/github/issues/Mathew222/Lumina?style=flat-square&color=5D6AD1" alt="Issues" />
</p>

---

## 📖 Overview

**Lumina** is a lightweight desktop application that provides real-time audio transcription and live subtitle overlays. Whether you are watching a video without captions, attending a live meeting, or need translation on the fly, Lumina captures system/mic audio and displays it in a highly customizable popup window.

## 🚀 Key Features

*   🎙️ **Real-time Transcription:** Ultra-low latency audio processing using Whisper/Vosk.
*   📝 **Live Subtitle Overlay:** A floating, transparent window that stays on top of other apps.
*   🎨 **Full Customization:** Change font size, text color, and background opacity to suit your needs.
*   🌐 **Translation Support:** Multi-language support for global accessibility.
*   ⚡ **Offline Capability:** Powered by localized engines for privacy and speed.

## 🛠️ Tech Stack

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB) ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white) ![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9) ![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white) ![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white) ![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54) ![OpenAI](https://img.shields.io/badge/Whisper-AI-black?style=for-the-badge&logo=openai)

---

## ⚙️ Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher)
*   `npm` or `yarn`

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Mathew222/Lumina.git
    cd Lumina
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run in development mode:**
    ```bash
    npm run electron:dev
    ```

4.  **Build for production:**
    ```bash
    npm run electron:build
    ```

---

## 🎨 Customization

Lumina allows you to tailor the experience via the settings panel:
*   **Font Settings:** Adjust size and weight for readability.
*   **Visuals:** Switch between Dark/Light modes or set custom HEX colors for subtitles.
*   **Engine Selection:** Choose between **Whisper.cpp** for high accuracy or **Vosk** for low-resource environments.

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---
