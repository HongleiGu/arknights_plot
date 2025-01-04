import React, { useState, useEffect} from 'react';
import { Tag, Input } from 'antd';
// import 'antd/dist/antd.css'; // Ensure you have Ant Design styles imported
import { CommentTag } from '@/utils/dataTypes';

const Page = (
  { initialTags, 
    onClose, 
    // onInputChange, 
    onInputComfirm,
    refresh,
  }: {
    initialTags: CommentTag[], 
    onClose: (id: number, commentId: number) => void,
    // onInputChange: (e: ChangeEvent) => void,
    onInputComfirm: (tag: string, commentId: number) => void,
    refresh: () => void
  }) => {
  const [tags, setTags] = useState<CommentTag[]>(initialTags);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Update internal state when initialTags prop changes
  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  const handleClose = (id: number, commentId: number) => {
    // const newTags = tags.filter(t => t !== tag);
    // setTags(newTags);
    // console.log(`Removed tag: ${tag}`);
    onClose(id, commentId);
    refresh();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputConfirm = () => {
    if (inputValue) {
      // const newTags = [...tags, inputValue];
      // setTags(newTags);
      onInputComfirm(inputValue, initialTags[0].commentId) // all the tags ahould have same commentId
      refresh();
      setInputValue('');
      // console.log(`Added tag: ${inputValue}`);

      
      // Call any callback function to handle the new tag
      // e.g., onTagsChange(newTags);
    }
    setInputVisible(false);
  };

  return (
    <div>
      {tags.map((tag) => (
        <Tag
          key={tag.id}
          closable
          onClose={() => handleClose(tag.id, tag.commentId)}
          style={{ backgroundColor: 'darkred', borderStyle: 'dashed', height: '20px', lineHeight: '20px', color: 'white', margin: '5px'}} // Match height of tags
        >
          {tag.tag}
        </Tag>
      ))}
      {inputVisible ? (
        <Input
          type="text"
          size="small"
          style={{ width: 78, height: '20px', lineHeight: '20px'}} // Match height of tags
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputConfirm}
          onPressEnter={handleInputConfirm}
        />
      ) : (
        <Tag
          onClick={() => setInputVisible(true)}
          style={{ backgroundColor: 'darkred', borderStyle: 'dashed', height: '20px', lineHeight: '20px', color: 'white', margin: '5px'}} // Match height of tags
        >
          +
        </Tag>
      )}
    </div>
  );
};

export default Page;