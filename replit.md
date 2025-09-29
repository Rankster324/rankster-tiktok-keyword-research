# Overview

Rankster is a focused TikTok Shop keyword research tool designed for Amazon sellers. This application provides a comprehensive keyword discovery and analysis platform with real TikTok Shop data. Key capabilities include a marketing landing page, advanced keyword search and filtering, and an administrative dashboard for data and user management. Users can subscribe to newsletters and search extensive keyword databases, while administrators can manage the entire system.

The project aims to provide Amazon sellers with unique insights into the TikTok Shop ecosystem, leveraging real data to identify high-potential and rising keywords. This app is part of a larger toolkit and focuses specifically on keyword research capabilities.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript, using Vite as the build tool.
- **Routing**: Wouter for lightweight client-side routing.
- **UI Components**: shadcn/ui library built on Radix UI primitives.
- **Styling**: Tailwind CSS with custom gradients and Inter font.
- **State Management**: React Query (TanStack Query) for server state management with aggressive cache invalidation using timestamp-based query keys for real-time data consistency.
- **Design System**: Modern startup aesthetic featuring glass morphism effects, vibrant gradients (blues, purples, teals), and mobile-responsive layouts. The search interface has been converted to a full-page experience for optimal data visualization.

## Backend Architecture
- **Runtime**: Node.js with Express.js server.
- **API Design**: RESTful endpoints, including those for email subscription and extensive keyword data retrieval.
- **Build Process**: ESBuild for server bundling, Vite for client bundling.

## Data Storage Solutions
- **Database**: PostgreSQL, connected via Neon Database serverless, managed with Drizzle ORM.
- **Schema**: Includes tables for users, email subscribers, and comprehensive keyword data (including regular, high-potential, and rising keywords) with a 3-level hierarchical category system.
- **Migration**: Drizzle Kit for schema migrations.
- **Performance Optimization**: Strategic database indexing (e.g., on `upload_period`, `category`, `search_volume`), PostgreSQL `DISTINCT ON` for deduplication, and optimized connection pooling.

## Authentication and Authorization
- **Current Implementation**: Admin login for content and user management with session management. Public search access does not require login; authentication is required only for specific search actions.

## Core Features
- **Keyword Research**: Supports searching for regular, high-potential (HPK), and rising (RK) keywords with distinct data models and display requirements.
- **Data Import**: Robust CSV bulk import system for administrators, handling various formats, validating data row-by-row, and providing detailed error reporting and progress tracking. Supports custom column mapping for different keyword types.
- **HPK Weekly Data Support**: HPK files use weekly data format (HPK-YYYYMMDD.csv) and maintain weekly date format (YYYY-MM-DD) in database storage and API responses for accurate temporal representation.
- **Category System**: Comprehensive 3-level hierarchical category system with intelligent keyword-to-category matching and accurate keyword counts.
- **Data Display**: Table views with pagination, multi-column sorting, and interactive information tooltips for metrics.
- **Newsletter Integration**: Automatic subscription to Beehiiv newsletter from login modal or homepage.
- **Real-time Data Consistency**: Implemented aggressive cache invalidation to ensure deleted uploads immediately disappear from search results, with frontend React Query optimized for real-time data accuracy. Fixed critical count discrepancy between categories API and search results by implementing proper deduplication using COUNT(DISTINCT keyword) and resolving HTTP caching issues. Categories dropdown now displays accurate keyword counts for all search types including Rising Keywords.
- **Period Selection**: Full support for multi-period data selection across all keyword types, with resolved auto-selection logic that allows manual period switching without interference.

# External Dependencies

## Core Framework Dependencies
- **React Ecosystem**: React 18, React DOM, TypeScript.
- **Build Tools**: Vite, ESBuild.

## UI and Styling
- **Component Library**: Radix UI primitives.
- **Styling**: Tailwind CSS, PostCSS, class-variance-authority.
- **Icons**: Lucide React.
- **Animations**: Embla Carousel.

## Database and Backend
- **Database**: Neon Database for PostgreSQL hosting.
- **ORM**: Drizzle ORM, Drizzle Kit.
- **Server**: Express.js, connect-pg-simple for session management.
- **Validation**: Zod.

## State Management and Data Fetching
- **Server State**: TanStack React Query.
- **Form Handling**: React Hook Form, Hookform Resolvers.
- **Date Utilities**: date-fns.

## Integrations
- **Newsletter**: Beehiiv.