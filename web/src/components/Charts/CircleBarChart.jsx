import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import useThemeStore from '../../stores/useThemeStore';

const CircleBarChart = ({ height = 260 }) => {
  const containerRef = useRef(null);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (!containerRef.current) return;
    const myChart = echarts.init(containerRef.current, mode === 'dark' ? 'dark' : undefined);

    const option = {
      angleAxis: { axisLabel: { fontSize: 10 } },
      radiusAxis: {
        type: 'category',
        data: ['Mon', 'Tue', 'Wed', 'Thu'],
        z: 10,
        axisLabel: { fontSize: 10 },
      },
      polar: { radius: '70%' },
      series: [
        { type: 'bar', data: [1, 2, 3, 4], coordinateSystem: 'polar', name: 'A', stack: 'a' },
        { type: 'bar', data: [2, 4, 6, 8], coordinateSystem: 'polar', name: 'B', stack: 'a' },
        { type: 'bar', data: [1, 2, 3, 4], coordinateSystem: 'polar', name: 'C', stack: 'a' },
      ],
      legend: { bottom: 0, data: ['A', 'B', 'C'], textStyle: { fontSize: 11 } },
    };

    myChart.setOption(option);
    const resize = () => myChart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      myChart.dispose();
    };
  }, [mode]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

export default CircleBarChart;
