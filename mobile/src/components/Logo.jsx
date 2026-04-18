import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Circle, Path, G, Rect, Ellipse, Filter, FeDropShadow, Text } from 'react-native-svg';

const Logo = ({ size = 40, variant = 'full' }) => {
  if (variant === 'icon') {
    return (
      <Svg width={size} height={size} viewBox="0 0 300 300">
        <Defs>
          <LinearGradient id="primaryGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#5A6BC8" />
            <Stop offset="50%" stopColor="#3F4FAF" />
            <Stop offset="100%" stopColor="#2D3B7F" />
          </LinearGradient>
          
          <LinearGradient id="secondaryGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FB7DB1" />
            <Stop offset="50%" stopColor="#F9629F" />
            <Stop offset="100%" stopColor="#E24A7F" />
          </LinearGradient>
          
          <LinearGradient id="completedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#48BB78" />
            <Stop offset="100%" stopColor="#38A169" />
          </LinearGradient>
          
          <LinearGradient id="highlightGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.3" />
          </LinearGradient>
          
          <Filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <FeDropShadow dx="6" dy="6" stdDeviation="4" floodColor="#000000" floodOpacity="0.3"/>
          </Filter>
          
          <Filter id="taskShadow" x="-50%" y="-50%" width="200%" height="200%">
            <FeDropShadow dx="3" dy="3" stdDeviation="2" floodColor="#000000" floodOpacity="0.4"/>
          </Filter>
        </Defs>
        
        {/* Base shadow */}
        <Ellipse cx="150" cy="280" rx="100" ry="12" fill="#000000" opacity="0.2"/>
        
        {/* Main clipboard/task board - 3D effect */}
        <G transform="translate(0, -10)">
          {/* Back face (depth) */}
          <Rect x="78" y="68" width="144" height="184" rx="12" 
                fill="url(#primaryGradient)" 
                opacity="0.6" 
                transform="translate(8, 8)"/>
          
          {/* Main clipboard */}
          <Rect x="70" y="60" width="144" height="184" rx="12" 
                fill="url(#primaryGradient)" 
                filter="url(#shadow)"/>
          
          {/* Clipboard header */}
          <Rect x="70" y="60" width="144" height="32" rx="12" 
                fill="url(#secondaryGradient)"/>
          
          {/* Clipboard clip */}
          <Rect x="130" y="45" width="24" height="20" rx="4" 
                fill="#FFFFFF" 
                filter="url(#taskShadow)" 
                opacity="0.9"/>
          
          {/* Inner paper area */}
          <Rect x="85" y="100" width="114" height="130" rx="6" 
                fill="#FFFFFF" 
                opacity="0.95" 
                filter="url(#taskShadow)"/>
          
          {/* Header highlight */}
          <Rect x="70" y="60" width="144" height="8" rx="12" 
                fill="url(#highlightGradient)" 
                opacity="0.6"/>
        </G>
        
        {/* Task Items with 3D checkboxes */}
        <G transform="translate(0, 20)">
          {/* Task 1 - Completed */}
          <G transform="translate(95, 85)">
            <Rect x="3" y="3" width="16" height="16" rx="3" 
                  fill="url(#completedGradient)" 
                  opacity="0.7"/>
            <Rect x="0" y="0" width="16" height="16" rx="3" 
                  fill="url(#completedGradient)" 
                  filter="url(#taskShadow)"/>
            <Path d="M4 8 L7 11 L12 5" 
                  stroke="#FFFFFF" 
                  strokeWidth="2.5" 
                  fill="none" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"/>
            <Rect x="24" y="6" width="60" height="4" rx="2" 
                  fill="#4A5568" 
                  opacity="0.8"/>
          </G>
          
          {/* Task 2 - Completed */}
          <G transform="translate(95, 110)">
            <Rect x="3" y="3" width="16" height="16" rx="3" 
                  fill="url(#completedGradient)" 
                  opacity="0.7"/>
            <Rect x="0" y="0" width="16" height="16" rx="3" 
                  fill="url(#completedGradient)" 
                  filter="url(#taskShadow)"/>
            <Path d="M4 8 L7 11 L12 5" 
                  stroke="#FFFFFF" 
                  strokeWidth="2.5" 
                  fill="none" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"/>
            <Rect x="24" y="6" width="50" height="4" rx="2" 
                  fill="#4A5568" 
                  opacity="0.8"/>
          </G>
          
          {/* Task 3 - In Progress */}
          <G transform="translate(95, 135)">
            <Rect x="3" y="3" width="16" height="16" rx="3" 
                  fill="url(#secondaryGradient)" 
                  opacity="0.7"/>
            <Rect x="0" y="0" width="16" height="16" rx="3" 
                  fill="url(#secondaryGradient)" 
                  filter="url(#taskShadow)"/>
            <Circle cx="8" cy="8" r="3" 
                    fill="#FFFFFF" 
                    opacity="0.9"/>
            <Rect x="24" y="6" width="65" height="4" rx="2" 
                  fill="#4A5568" 
                  opacity="0.8"/>
          </G>
          
          {/* Task 4 - Pending */}
          <G transform="translate(95, 160)">
            <Rect x="3" y="3" width="16" height="16" rx="3" 
                  fill="#E2E8F0" 
                  opacity="0.7"/>
            <Rect x="0" y="0" width="16" height="16" rx="3" 
                  fill="#FFFFFF" 
                  stroke="#CBD5E0" 
                  strokeWidth="2" 
                  filter="url(#taskShadow)"/>
            <Rect x="24" y="6" width="45" height="4" rx="2" 
                  fill="#A0AEC0" 
                  opacity="0.8"/>
          </G>
          
          {/* Task 5 - Pending */}
          <G transform="translate(95, 185)">
            <Rect x="3" y="3" width="16" height="16" rx="3" 
                  fill="#E2E8F0" 
                  opacity="0.7"/>
            <Rect x="0" y="0" width="16" height="16" rx="3" 
                  fill="#FFFFFF" 
                  stroke="#CBD5E0" 
                  strokeWidth="2" 
                  filter="url(#taskShadow)"/>
            <Rect x="24" y="6" width="55" height="4" rx="2" 
                  fill="#A0AEC0" 
                  opacity="0.8"/>
          </G>
        </G>
        
        {/* Progress indicator ring */}
        <G transform="translate(220, 90)">
          <Circle cx="0" cy="0" r="22" 
                  fill="none" 
                  stroke="#E2E8F0" 
                  strokeWidth="6" 
                  opacity="0.3"/>
          <Circle cx="0" cy="0" r="22" 
                  fill="none" 
                  stroke="url(#secondaryGradient)" 
                  strokeWidth="6" 
                  strokeLinecap="round"
                  strokeDasharray="55 140"
                  transform="rotate(-90)"
                  filter="url(#taskShadow)"/>
          <Circle cx="0" cy="0" r="12" 
                  fill="url(#primaryGradient)" 
                  filter="url(#taskShadow)"/>
          <Text x="0" y="3" 
                textAnchor="middle" 
                fontFamily="Arial, sans-serif" 
                fontSize="8" 
                fontWeight="bold" 
                fill="#FFFFFF">40%</Text>
        </G>
        
        {/* CRM connection indicators */}
        <G opacity="0.7">
          <Circle cx="50" cy="120" r="6" 
                  fill="url(#secondaryGradient)" 
                  filter="url(#taskShadow)"/>
          <Circle cx="250" cy="160" r="6" 
                  fill="url(#primaryGradient)" 
                  filter="url(#taskShadow)"/>
          <Circle cx="80" cy="220" r="5" 
                  fill="url(#secondaryGradient)" 
                  filter="url(#taskShadow)"/>
          
          <Path d="M50 120 Q80 100 120 110" 
                stroke="url(#secondaryGradient)" 
                strokeWidth="2" 
                fill="none" 
                opacity="0.6"/>
          <Path d="M190 140 Q220 150 250 160" 
                stroke="url(#primaryGradient)" 
                strokeWidth="2" 
                fill="none" 
                opacity="0.6"/>
          <Path d="M80 220 Q110 200 130 180" 
                stroke="url(#secondaryGradient)" 
                strokeWidth="2" 
                fill="none" 
                opacity="0.6"/>
        </G>
        
        {/* Modern accent elements */}
        <G opacity="0.5">
          <Rect x="40" y="80" width="8" height="8" rx="2" 
                fill="url(#secondaryGradient)" 
                filter="url(#taskShadow)" 
                transform="rotate(15 44 84)"/>
          <Rect x="260" y="200" width="6" height="6" rx="1" 
                fill="url(#primaryGradient)" 
                filter="url(#taskShadow)" 
                transform="rotate(-20 263 203)"/>
        </G>
      </Svg>
    );
  }

  if (variant === 'text') {
    return (
      <Svg width={size * 2} height={size * 0.6} viewBox="0 0 80 24">
        <Defs>
          <LinearGradient id="textGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#3F4FAF" />
            <Stop offset="50%" stopColor="#F9629F" />
            <Stop offset="100%" stopColor="#3F4FAF" />
          </LinearGradient>
        </Defs>
        
        {/* e */}
        <Path 
          d="M 2 12 C 2 8 4 6 8 6 C 12 6 14 8 14 12 C 14 16 12 18 8 18 C 4 18 2 16 2 12 Z M 6 12 L 12 12" 
          fill="none" 
          stroke="url(#textGradient)" 
          strokeWidth="2" 
          strokeLinecap="round"
        />
        
        {/* C */}
        <Path 
          d="M 24 18 C 20 18 18 16 18 12 C 18 8 20 6 24 6 C 26 6 28 7 28 8" 
          fill="none" 
          stroke="url(#textGradient)" 
          strokeWidth="2" 
          strokeLinecap="round"
        />
        
        {/* R */}
        <Path 
          d="M 32 18 L 32 6 L 38 6 C 40 6 42 7 42 9 C 42 11 40 12 38 12 L 32 12 M 38 12 L 42 18" 
          fill="none" 
          stroke="url(#textGradient)" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
        
        {/* M */}
        <Path 
          d="M 46 18 L 46 6 L 50 14 L 54 6 L 54 18" 
          fill="none" 
          stroke="url(#textGradient)" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
        
        {/* Connection dots */}
        <Circle cx="60" cy="8" r="1" fill="#F9629F" />
        <Circle cx="65" cy="12" r="1.5" fill="#3F4FAF" />
        <Circle cx="70" cy="16" r="1" fill="#F9629F" />
        
        {/* Connection lines */}
        <Path d="M 60 8 L 65 12 L 70 16" stroke="#3F4FAF" strokeWidth="1" opacity="0.6" />
      </Svg>
    );
  }

  // Full logo with icon and text
  return (
    <Svg width={size * 2.5} height={size} viewBox="0 0 100 40">
      <Defs>
        <LinearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#3F4FAF" />
          <Stop offset="100%" stopColor="#1E34AE" />
        </LinearGradient>
        <LinearGradient id="secondaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#F9629F" />
          <Stop offset="100%" stopColor="#E5558C" />
        </LinearGradient>
        <LinearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#3F4FAF" />
          <Stop offset="50%" stopColor="#F9629F" />
          <Stop offset="100%" stopColor="#3F4FAF" />
        </LinearGradient>
      </Defs>
      
      {/* Icon section */}
      <G>
        {/* Background circle */}
        <Circle cx="20" cy="20" r="16" fill="url(#primaryGrad)" />
        
        {/* Task Management icon */}
        <Path 
          d="M 8 6 L 32 6 L 32 34 L 8 34 Z" 
          fill="#FFFFFF" 
          stroke="none"
          rx="2"
        />
        
        {/* Tasks */}
        <G>
          {/* Completed task */}
          <Path d="M 10 10 L 14 10 L 14 14 L 10 14 Z" fill="url(#secondaryGrad)" rx="1" />
          <Path d="M 11.5 12.5 L 12.5 13.5 L 14.5 11.5" stroke="#FFFFFF" strokeWidth="0.8" strokeLinecap="round" fill="none" />
          <Path d="M 16 12 L 28 12" stroke="#3F4FAF" strokeWidth="1.2" strokeLinecap="round" />
          
          {/* In progress task */}
          <Path d="M 10 18 L 14 18 L 14 22 L 10 22 Z" fill="#FFFFFF" stroke="url(#secondaryGrad)" strokeWidth="0.8" rx="1" />
          <Circle cx="12" cy="20" r="1.2" fill="url(#secondaryGrad)" />
          <Path d="M 16 20 L 26 20" stroke="#3F4FAF" strokeWidth="1.2" strokeLinecap="round" />
          
          {/* Pending task */}
          <Path d="M 10 26 L 14 26 L 14 30 L 10 30 Z" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="0.8" rx="1" />
          <Path d="M 16 28 L 24 28" stroke="#9CA3AF" strokeWidth="1.2" strokeLinecap="round" />
        </G>
        
        {/* Customer icon */}
        <G opacity="0.7">
          <Circle cx="28" cy="10" r="1.2" fill="url(#secondaryGrad)" />
          <Path d="M 26.5 12.5 C 26.5 11.8 27.2 11.2 28 11.2 C 28.8 11.2 29.5 11.8 29.5 12.5" 
                stroke="url(#secondaryGrad)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        </G>
      </G>
      
      {/* Text section */}
      <G transform="translate(45, 20)">
        {/* e */}
        <Path 
          d="M 0 0 C 0 -3 1.5 -4.5 4 -4.5 C 6.5 -4.5 8 -3 8 0 C 8 3 6.5 4.5 4 4.5 C 1.5 4.5 0 3 0 0 Z M 2 0 L 7 0" 
          fill="none" 
          stroke="url(#textGrad)" 
          strokeWidth="1.5" 
          strokeLinecap="round"
        />
        
        {/* C */}
        <Path 
          d="M 14 4.5 C 11.5 4.5 10 3 10 0 C 10 -3 11.5 -4.5 14 -4.5 C 15.5 -4.5 16.5 -3.5 16.5 -2.5" 
          fill="none" 
          stroke="url(#textGrad)" 
          strokeWidth="1.5" 
          strokeLinecap="round"
        />
        
        {/* R */}
        <Path 
          d="M 18 4.5 L 18 -4.5 L 23 -4.5 C 24.5 -4.5 26 -3.5 26 -1.5 C 26 0.5 24.5 1.5 23 1.5 L 18 1.5 M 23 1.5 L 26 4.5" 
          fill="none" 
          stroke="url(#textGrad)" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
        
        {/* M */}
        <Path 
          d="M 28 4.5 L 28 -4.5 L 31 2 L 34 -4.5 L 34 4.5" 
          fill="none" 
          stroke="url(#textGrad)" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
        
        {/* Decorative elements */}
        <Circle cx="38" cy="-2" r="0.8" fill="#F9629F" />
        <Circle cx="41" cy="0" r="1" fill="#3F4FAF" />
        <Circle cx="44" cy="2" r="0.8" fill="#F9629F" />
        <Path d="M 38 -2 L 41 0 L 44 2" stroke="#3F4FAF" strokeWidth="0.8" opacity="0.6" />
      </G>
    </Svg>
  );
};

export default Logo;