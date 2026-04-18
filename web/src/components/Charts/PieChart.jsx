import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import useThemeStore from '../../stores/useThemeStore';

const PieChart = ({ height = 260 }) => {
  const containerRef = useRef(null);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (!containerRef.current) return;
    const myChart = echarts.init(containerRef.current, mode === 'dark' ? 'dark' : undefined);

    const option = {
      tooltip: { trigger: 'item', formatter: '{a} <br/>{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [
        {
          name: 'Access From',
          type: 'pie',
          selectedMode: 'single',
          radius: [0, '28%'],
          center: ['50%', '45%'],
          label: { position: 'inner', fontSize: 10 },
          labelLine: { show: false },
          data: [
            { value: 1548, name: 'Search Engine' },
            { value: 775, name: 'Direct' },
            { value: 679, name: 'Marketing', selected: true },
          ],
        },
        {
          name: 'Access From',
          type: 'pie',
          radius: ['42%', '58%'],
          center: ['50%', '45%'],
          labelLine: { length: 10 },
          label: { fontSize: 10 },
          data: [
            { value: 1048, name: 'Baidu' },
            { value: 335, name: 'Direct' },
            { value: 310, name: 'Email' },
            { value: 251, name: 'Google' },
            { value: 234, name: 'Union Ads' },
            { value: 147, name: 'Bing' },
            { value: 135, name: 'Video Ads' },
            { value: 102, name: 'Others' },
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

export default PieChart;
