# Portfolio_website

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-REST%20API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Self-Hosted](https://img.shields.io/badge/Deployment-Self--Hosted-blue?style=for-the-badge&logo=linux&logoColor=white)

A full-stack, self-hosted portfolio web platform designed for developers to showcase both **open-source** and **proprietary/private** projects. Beyond standard repository links, this platform allows creators to distribute downloadable project samples/builds, provide deep technical breakdowns, and maintain a comprehensive, interactive Curriculum Vitae (CV).

---

## Table of Contents

- [About the Project](#about-the-project)
- [Key Features](#key-features)
- [Tech Stack & Architecture](#tech-stack--architecture)
- [Project Structure](#project-structure)
- [REST API Overview](#rest-api-overview)
- [Collaborators](#collaborators)
- [License](#license)

---

## About the Project

Traditional portfolios often limit developers to linking public GitHub repositories. However, many real-world, academic, or commercial projects cannot have their source code publicly exposed. 

**Portfolio_website** solves this by offering a dual-showcase approach:
1. **Open-Source Projects:** Direct links to live demos and external version control repositories.
2. **Closed-Source / Private Projects:** Secure hosting for compiled builds, demo packages, or executable samples that visitors can download directly, accompanied by rich media previews and technical documentation.

---

## Key Features

### Authentication & Authorization
* **User Authentication:** Secure login and session/token management (e.g., JWT or HTTP-only cookies) with hashed passwords (`bcrypt`).
* **Role & Ownership Authorization:** Strict access control ensuring that only authenticated users can create new entries, and users can only edit or delete their own profiles and projects.

### Dynamic Project Management
Authenticated users can publish and manage projects featuring:
* **Overview:** Project title and comprehensive description.
* **Media Carousel:** Interactive gallery supporting both images and video previews/demos.
* **Repository Integration:** Optional external links (GitHub, GitLab, live deployment) for open-source work.
* **Sample Downloads:** Direct file download support for private projects (e.g., `.zip`, `.exe`, `.apk`, or demo builds) without exposing source code.
* **Technical Specifications Tab:** Dedicated section detailing the engineering behind the project—programming languages, frameworks, third-party APIs, databases, and architectural patterns used.

### Interactive Developer Profile & CV Builder
Each user has a customizable profile organized into intuitive tabs:
* **Structured Resume Fields:** Interactive tabs for *About Me*, *Work Experience*, *Education*, *Technical Skills*, *Certifications*, and *Contact Information*.
* **Custom Resume Attachment:** Functionality to upload, preview, and allow recruiters/visitors to download the user's personal CV document (PDF).

---

## Tech Stack & Architecture

The application follows a decoupled client-server architecture communicating exclusively via a **RESTful API**:

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 (Responsive UI & Media Carousel).
* **Backend:** Node.js (REST API server, file upload handling via `multer`, authentication middleware).
* **Database:** SQLite3 (Relational data storage).
* **Infrastructure:** Self-hosted environment (Linux/Windows Server, Reverse Proxy with Nginx, Process Management with PM2).

---

## Project Structure

```text
Portfolio_website/
├── backend/
│   ├── config/          # Database connection & environment config
│   ├── controllers/     # Request handlers (Auth, Users, Projects)
│   ├── database/        # SQLite (.db) file & SQL migration/schema scripts
│   ├── middleware/      # Authentication & authorization guards
│   ├── routes/          # REST API route definitions
│   ├── uploads/         # Stored media, project samples, and user CVs
│   └── server.js        # Node.js entry point
├── frontend/
│   ├── assets/          # Static icons and fallback placeholders
│   ├── css/             # Stylesheets
│   ├── js/              # API fetch clients, carousel logic, auth state
│   └── index.html       # Main application entry
├── .env.example         # Environment variables template
├── package.json         # Dependencies and scripts
└── README.md            # Project documentation
```
---

## REST API Overview

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public / Admin | Register a new portfolio user |
| `POST` | `/api/auth/login` | Public | Authenticate user and return token |
| `GET` | `/api/users/:username` | Public | Retrieve user profile, CV tabs, and resume link |
| `PUT` | `/api/users/:username` | Owner Only | Update CV fields or upload a new PDF resume |
| `GET` | `/api/projects` | Public | List all published projects |
| `GET` | `/api/projects/:id` | Public | Get full project details, carousel media & tech tab |
| `POST` | `/api/projects` | Authenticated | Create a new project with media & sample files |
| `PUT` | `/api/projects/:id` | Owner Only | Update an existing project |
| `DELETE` | `/api/projects/:id` | Owner Only | Delete a project and its associated files |
| `GET` | `/api/projects/:id/download` | Public | Download the sample package for a private project |

---

## Collaborators

Developed and maintained by:

* **Miguel Ribeiro** — [@MiguelRibeiro1210](https://github.com/MiguelRibeiro1210)
* **Pedro** — [@Pedro-p21](https://github.com/Pedro-p21)
