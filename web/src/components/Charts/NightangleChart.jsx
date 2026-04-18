import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import useThemeStore from '../../stores/useThemeStore';

const NightingaleChart = ({ height = 260 }) => {
  const containerRef = useRef(null);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (!containerRef.current) return;
    const myChart = echarts.init(containerRef.current, mode === 'dark' ? 'dark' : undefined);

    const option = {
      legend: { bottom: 0, textStyle: { fontSize: 10 } },
      series: [
        {
          name: 'Nightingale Chart',
          type: 'pie',
          radius: [20, 80],
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: { borderRadius: 6 },
          label: { fontSize: 10 },
          data: [
            { value: 40, name: 'rose 1' },
            { value: 38, name: 'rose 2' },
            { value: 32, name: 'rose 3' },
            { value: 30, name: 'rose 4' },
            { value: 28, name: 'rose 5' },
            { value: 26, name: 'rose 6' },
            { value: 22, name: 'rose 7' },
            { value: 18, name: 'rose 8' },
          ],
        },
      ],
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

export default NightingaleChart;
